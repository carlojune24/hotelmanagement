import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import {
	brandingSchema,
	mergeBrandingIntoConfig,
	parseBranding,
	type HotelBranding
} from '$lib/server/branding';
import { deleteUploadIfOwned, saveUpload, UploadValidationError } from '$lib/server/uploads';
import type { SessionUser } from '$lib/server/auth/session';
import { MAX_GALLERY_IMAGES } from '$lib/branding';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	return { branding: parseBranding(locals.hotel!.config) };
};

/** Empty form fields post `""`; treat that as "not provided" before validation. */
const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);
const blankToNum = (v: unknown) => {
	if (v === '' || v == null) return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
};

async function persistBranding(
	hotelId: string,
	currentConfig: unknown,
	next: HotelBranding,
	actor: SessionUser | null
) {
	const nextConfig = mergeBrandingIntoConfig(currentConfig, next);
	await db
		.update(hotels)
		.set({ config: nextConfig, updatedAt: new Date() })
		.where(eq(hotels.id, hotelId));
	await writeAudit({
		hotelId,
		actor,
		action: 'hotel.update_branding',
		entityType: 'hotel',
		entityId: hotelId,
		after: next
	});
}

export const actions: Actions = {
	updateBranding: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const current = parseBranding(hotel.config);

		const raw = await event.request.formData();
		const logoFile = raw.get('logo');
		const heroFile = raw.get('heroImage');

		let logoUrl = current.logoUrl;
		let heroImageUrl = current.heroImageUrl;
		try {
			if (logoFile instanceof File && logoFile.size > 0) {
				const uploaded = await saveUpload(hotel.id, logoFile);
				await deleteUploadIfOwned(current.logoUrl);
				logoUrl = uploaded;
			}
			if (heroFile instanceof File && heroFile.size > 0) {
				const uploaded = await saveUpload(hotel.id, heroFile);
				await deleteUploadIfOwned(current.heroImageUrl);
				heroImageUrl = uploaded;
			}
		} catch (e) {
			if (e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}

		const cleaned = {
			logoUrl,
			accentColor: blankToUndef(raw.get('accentColor')),
			paperColor: blankToUndef(raw.get('paperColor')),
			heroImageUrl,
			heroVideoUrl: current.heroVideoUrl,
			fontDisplay: blankToUndef(raw.get('fontDisplay')),
			tagline: blankToUndef(raw.get('tagline')),
			about: blankToUndef(raw.get('about')),
			galleryImages: current.galleryImages,
			checkInPolicy: blankToUndef(raw.get('checkInPolicy')),
			checkOutPolicy: blankToUndef(raw.get('checkOutPolicy')),
			contactPhone: blankToUndef(raw.get('contactPhone')),
			contactEmail: blankToUndef(raw.get('contactEmail')),
			contactAddress: blankToUndef(raw.get('contactAddress')),
			contactLat: blankToNum(raw.get('contactLat')),
			contactLng: blankToNum(raw.get('contactLng'))
		};
		const parsed = brandingSchema.safeParse(cleaned);
		if (!parsed.success) return fail(400, { error: 'Check the branding fields and try again.' });

		await persistBranding(hotel.id, hotel.config, parsed.data, event.locals.user);
		return { ok: 'Branding saved.' };
	},

	removeLogo: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const current = parseBranding(hotel.config);
		await deleteUploadIfOwned(current.logoUrl);
		const { logoUrl: _drop, ...rest } = current;
		await persistBranding(hotel.id, hotel.config, rest, event.locals.user);
		return { ok: 'Logo removed.' };
	},

	removeHeroImage: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const current = parseBranding(hotel.config);
		await deleteUploadIfOwned(current.heroImageUrl);
		const { heroImageUrl: _drop, ...rest } = current;
		await persistBranding(hotel.id, hotel.config, rest, event.locals.user);
		return { ok: 'Hero image removed.' };
	},

	uploadHeroVideo: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const current = parseBranding(hotel.config);

		const raw = await event.request.formData();
		const file = raw.get('heroVideo');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Choose a video.' });
		}

		try {
			const uploaded = await saveUpload(hotel.id, file, 'video');
			await deleteUploadIfOwned(current.heroVideoUrl);
			await persistBranding(
				hotel.id,
				hotel.config,
				{ ...current, heroVideoUrl: uploaded },
				event.locals.user
			);
			return { ok: 'Hero video updated.' };
		} catch (e) {
			if (e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	removeHeroVideo: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const current = parseBranding(hotel.config);
		await deleteUploadIfOwned(current.heroVideoUrl);
		const { heroVideoUrl: _drop, ...rest } = current;
		await persistBranding(hotel.id, hotel.config, rest, event.locals.user);
		return { ok: 'Hero video removed.' };
	},

	uploadGalleryImages: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const current = parseBranding(hotel.config);
		const existing = current.galleryImages ?? [];

		const raw = await event.request.formData();
		const files = raw.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
		if (files.length === 0) return fail(400, { error: 'Choose at least one photo.' });

		const room = MAX_GALLERY_IMAGES - existing.length;
		if (room <= 0) {
			return fail(400, {
				error: `You already have ${MAX_GALLERY_IMAGES} gallery photos — remove one first.`
			});
		}

		try {
			const uploaded = await Promise.all(files.slice(0, room).map((f) => saveUpload(hotel.id, f)));
			await persistBranding(
				hotel.id,
				hotel.config,
				{ ...current, galleryImages: [...existing, ...uploaded] },
				event.locals.user
			);
			const skipped = files.length - uploaded.length;
			return {
				ok:
					`Added ${uploaded.length} photo${uploaded.length === 1 ? '' : 's'}.` +
					(skipped > 0 ? ` ${skipped} skipped — gallery limit reached.` : '')
			};
		} catch (e) {
			if (e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	removeGalleryImage: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const current = parseBranding(hotel.config);

		const raw = await event.request.formData();
		const url = String(raw.get('url') ?? '');
		const nextGallery = (current.galleryImages ?? []).filter((u) => u !== url);

		await deleteUploadIfOwned(url);
		await persistBranding(
			hotel.id,
			hotel.config,
			{ ...current, galleryImages: nextGallery.length > 0 ? nextGallery : undefined },
			event.locals.user
		);
		return { ok: 'Photo removed.' };
	}
};
