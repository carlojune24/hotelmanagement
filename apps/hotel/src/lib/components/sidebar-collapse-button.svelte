<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';

	const sidebar = Sidebar.useSidebar();
	const label = $derived(sidebar.state === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar');
</script>

<Sidebar.MenuItem>
	<Sidebar.MenuButton onclick={() => sidebar.toggle()} tooltipContent={label}>
		<PanelLeftIcon />
		<span>{label}</span>
	</Sidebar.MenuButton>
</Sidebar.MenuItem>
