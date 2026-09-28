import type { CameraController } from './controller.js';
import type { InputLock } from './input-lock.js';
import { getSettings, panicLocal } from './settings.js';

export function createControlPanel(controller: CameraController, input: InputLock) {
	return class CameraControlPanel extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
		static override DEFAULT_OPTIONS = {
			id: 'lib-camera-controls',
			classes: ['lib-camera-controls'],
			window: { title: 'libCamera', resizable: true },
			position: { width: 640, height: 'auto' as const },
		};

		static override PARTS = { controls: { template: 'modules/lib-camera/templates/controls.hbs' } };

		protected override async _prepareContext() {
			const local = getSettings().get('lib-camera', 'localPriorities') as Record<string, number>;
			const defaults = getSettings().get('lib-camera', 'priorities') as Record<string, number>;
			const owner = game.user?.id ? controller.ownership.getOwner(game.user.id) : undefined;
			return {
				tabs: {},
				isGM: game.user?.isGM,
				disabled: controller.ownership.isDisabled(game.user?.id),
				worldDisabled: getSettings().get('lib-camera', 'worldDisabled'),
				locked: input.active,
				owner: owner?.consumerId,
				consumers: controller.ownership.getConsumers(game.user?.id).map(consumer => ({
					...consumer,
					localPriority: Object.hasOwn(local, consumer.id) ? local[consumer.id] : '',
					defaultPriority: Object.hasOwn(defaults, consumer.id) ? defaults[consumer.id] : '',
				})),
				diagnostics: controller.ownership.getDiagnostics().slice(-10).reverse(),
			};
		}

		protected override _onClickAction(_event: PointerEvent, target: HTMLElement): void {
			void this.#action(target.dataset.action).catch((error: unknown) => {
				ui.notifications?.error(error instanceof Error ? error.message : 'Unable to update camera controls');
			});
		}

		async #action(action?: string): Promise<void> {
			switch (action) {
				case 'panic':
					await panicLocal(controller);
					break;
				case 'release':
					controller.releaseLocal();
					break;
				case 'resume':
					await getSettings().set('lib-camera', 'disabled', false);
					break;
				case 'world-panic':
					if (!game.user?.isGM) return;
					controller.panic();
					await getSettings().set('lib-camera', 'worldDisabled', true);
					break;
				case 'world-resume':
					if (!game.user?.isGM) return;
					await getSettings().set('lib-camera', 'worldDisabled', false);
					break;
				case 'save':
					await this.#savePriorities();
					break;
			}
			await this.render({ force: true });
		}

		async #savePriorities(): Promise<void> {
			const local = { ...getSettings().get('lib-camera', 'localPriorities') as Record<string, number> };
			const defaults = { ...getSettings().get('lib-camera', 'priorities') as Record<string, number> };
			for (const field of this.element.querySelectorAll<HTMLInputElement>('input[data-consumer]')) {
				const id = field.dataset.consumer;
				if (!id || (field.dataset.scope === 'world' && !game.user?.isGM)) continue;
				const values = field.dataset.scope === 'world' ? defaults : local;
				if (!field.value.trim()) {
					delete values[id];
					continue;
				}
				const priority = Number(field.value);
				if (!Number.isSafeInteger(priority)) throw new Error('Camera priorities must be whole numbers');
				Object.defineProperty(values, id, { value: priority, enumerable: true, configurable: true, writable: true });
			}
			if (game.user?.isGM) await getSettings().set('lib-camera', 'priorities', defaults);
			await getSettings().set('lib-camera', 'localPriorities', local);
		}
	};
}
