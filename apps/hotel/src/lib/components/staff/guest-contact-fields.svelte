<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { emailCheck, nameError, phoneError } from '$lib/guest-validation';

	let {
		prefix,
		emailOptional = false,
		splitName = false,
		valid = $bindable(true)
	}: { prefix: string; emailOptional?: boolean; /** First + last name inputs, as an OTA voucher prints them. */ splitName?: boolean; valid?: boolean } = $props();

	let first = $state('');
	let last = $state('');
	let full = $state('');
	const name = $derived(splitName ? `${first.trim()} ${last.trim()}`.trim() : full);
	let email = $state('');
	let phone = $state('');
	let touched = $state({ name: false, email: false, phone: false });

	const nErr = $derived(nameError(name));
	const eChk = $derived(emailCheck(email));
	const pErr = $derived(phoneError(phone));
	$effect(() => {
		valid = !nErr && !eChk.error && !pErr;
	});

	const bad = 'border-danger focus-visible:ring-danger/30';
</script>

{#if splitName}
	<div class="grid grid-cols-2 gap-3">
		<div>
			<Label for="{prefix}FirstName">First name</Label>
			<Input id="{prefix}FirstName" required maxlength={80} bind:value={first} onblur={() => (touched.name = true)} aria-invalid={touched.name && !!nErr} class="mt-1 {touched.name && nErr ? bad : ''}" />
		</div>
		<div>
			<Label for="{prefix}LastName">Last name</Label>
			<Input id="{prefix}LastName" required maxlength={80} bind:value={last} onblur={() => (touched.name = true)} aria-invalid={touched.name && !!nErr} class="mt-1 {touched.name && nErr ? bad : ''}" />
		</div>
	</div>
	<input type="hidden" name="fullName" value={name} />
	{#if touched.name && nErr}<p class="-mt-2 text-xs text-danger" role="alert">{nErr}</p>{/if}
{:else}
	<div>
		<Label for="{prefix}FullName">Full name</Label>
		<Input
			id="{prefix}FullName"
			name="fullName"
			required
			maxlength={160}
			bind:value={full}
			onblur={() => (touched.name = true)}
			aria-invalid={touched.name && !!nErr}
			class="mt-1 {touched.name && nErr ? bad : ''}"
		/>
		{#if touched.name && nErr}<p class="mt-1 text-xs text-danger" role="alert">{nErr}</p>{/if}
	</div>
{/if}
<div class="grid grid-cols-2 gap-3">
	<div>
		<Label for="{prefix}Email">Email{emailOptional ? ' (optional)' : ''}</Label>
		<Input
			id="{prefix}Email"
			name="email"
			type="email"
			required={!emailOptional}
			bind:value={email}
			onblur={() => (touched.email = true)}
			aria-invalid={touched.email && !!eChk.error}
			class="mt-1 {touched.email && eChk.error ? bad : ''}"
		/>
		{#if touched.email && eChk.error}
			<p class="mt-1 text-xs text-danger" role="alert">
				{eChk.error}
				{#if eChk.suggestion}
					<button type="button" class="underline" onclick={() => (email = eChk.suggestion!)}>
						Use {eChk.suggestion}
					</button>
				{/if}
			</p>
		{/if}
	</div>
	<div>
		<Label for="{prefix}Phone">Phone</Label>
		<Input
			id="{prefix}Phone"
			name="phone"
			maxlength={40}
			inputmode="tel"
			bind:value={phone}
			onblur={() => (touched.phone = true)}
			aria-invalid={touched.phone && !!pErr}
			class="mt-1 {touched.phone && pErr ? bad : ''}"
		/>
		{#if touched.phone && pErr}<p class="mt-1 text-xs text-danger" role="alert">{pErr}</p>{/if}
	</div>
</div>
