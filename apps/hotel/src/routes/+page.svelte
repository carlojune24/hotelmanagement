<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
</script>

<div class="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 text-center">
	<h1 class="text-lg font-semibold text-ink">No hotel access yet</h1>
	<p class="mt-2 text-sm text-ink-muted">
		Your account isn't a member of any hotel. Ask your hotel admin to invite you, or contact
		platform support.
	</p>
	<form method="POST" action="/auth/logout" class="mt-4">
		<Button variant="outline" type="submit">Sign out</Button>
	</form>
</div>
