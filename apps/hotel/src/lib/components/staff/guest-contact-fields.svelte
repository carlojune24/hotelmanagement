<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { emailCheck, nameError, phoneError } from '$lib/guest-validation';

	let {
		prefix,
		emailOptional = false,
		valid = $bindable(true)
	}: { prefix: string; emailOptional?: boolean; valid?: boolean } = $props();

	let name = $state('');
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

<div>
	<Label for="{prefix}FullName">Full name</Label>
	<Input
		id="{prefix}FullName"
		name="fullName"
		required
		maxlength={160}
		bind:value={name}
		onblur={() => (touched.name = true)}
		aria-invalid={touched.name && !!nErr}
		class="mt-1 {touched.name && nErr ? bad : ''}"
	/>
	{#if touched.name && nErr}<p class="mt-1 text-xs text-danger" role="alert">{nErr}</p>{/if}
</div>
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
