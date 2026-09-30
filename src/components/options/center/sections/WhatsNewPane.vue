<template>
	<div class="container mx-auto max-w-5xl p-4">
		<div v-for="release in releases" :key="release.version" class="card bg-base-200 mb-4">
			<div class="card-body">
				<h2 class="card-title">
					Version {{ release.version }}
					<span v-if="release.version === currentVersion" class="badge badge-primary badge-sm">
						installed
					</span>
				</h2>

				<div v-for="feature in release.features" :key="feature.title" class="mt-2">
					<h3 class="font-semibold">{{ feature.emoji }} {{ feature.title }}</h3>
					<p class="text-sm opacity-80">{{ feature.description }}</p>
				</div>
			</div>
		</div>
	</div>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue';
import { RELEASES, _markWhatsNewSeen } from '../../../../common/whatsNew.ts';

const releases = RELEASES;
const currentVersion = chrome.runtime.getManifest().version;

onMounted(() => {
	void _markWhatsNewSeen();
});
</script>
