import type { CameraAdapter } from './movement.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraController } from './controller.js';
import { RemoteCamera } from './remote.js';

const peers: RemoteCamera[] = [];
afterEach(() => {
	for (const peer of peers.splice(0)) peer.dispose();
	vi.useRealTimers();
});
function setup() {
	vi.useFakeTimers();
	const users = [{ id: 'gm', isGM: true, active: true }, { id: 'player', isGM: false, active: true }, { id: 'silent', isGM: false, active: true }];
	const make = (id: string) => {
		let position = { x: 0, y: 0, scale: 1 };
		const adapter: CameraAdapter = {
			read: () => position,
			pan: vi.fn((next) => { position = next; }),
			animate: vi.fn(async (next) => {
				position = next;
				return true;
			}),
			lockInput: () => () => {},
		};
		const controller = new CameraController(adapter, () => id);
		controller.register({ id: 'obs-utils', name: 'OBS Utils' });
		const emit = vi.fn((packet: object, targets: string[]) => {
			for (const peer of peers) {
				if (targets.includes(peer.environment.userId()!)) void peer.receive(packet, id);
			}
		});
		const remote = new RemoteCamera(controller, { userId: () => id, users: () => users, sceneId: () => 'scene', read: adapter.read, emit });
		peers.push(remote);
		return { remote, controller, adapter, emit };
	};
	return { gm: make('gm'), first: make('player'), second: make('player') };
}

describe('remote camera', () => {
	it('targets every session of a user and collects real acknowledgements', async () => {
		const { gm, first, second } = setup();
		const result = gm.remote.move('obs-utils', 'player', { x: 10 });
		await vi.advanceTimersByTimeAsync(2000);
		expect(await result).toMatchObject([{ userId: 'player', status: 'acknowledged', outcomes: [{ status: 'completed' }, { status: 'completed' }] }]);
		expect(first.adapter.pan).toHaveBeenCalledOnce();
		expect(second.adapter.pan).toHaveBeenCalledOnce();
	});

	it('rejects forged identity, remote priorities, and wrong scenes', async () => {
		const { gm, first } = setup();
		const packet = { kind: 'request', id: 'forged', consumer: 'obs-utils', sceneId: 'scene', action: 'move', data: { x: 100 }, sender: 'gm', priority: 999 };
		await gm.remote.receive(packet, 'player');
		expect(gm.adapter.pan).not.toHaveBeenCalled();
		await first.remote.receive({ ...packet, id: 'wrong-scene', sceneId: 'other' }, 'gm');
		expect(first.adapter.pan).not.toHaveBeenCalled();
		const owner = first.controller.register({ id: 'owner', name: 'Owner', priority: 1 }).acquire();
		await first.remote.receive(packet, 'gm');
		expect(owner.ok && owner.claim.active).toBe(true);
		expect(first.adapter.pan).not.toHaveBeenCalled();
	});

	it('broadcasts to active users and reports receiver panic without claiming completion', async () => {
		const { gm, first, second } = setup();
		first.adapter.animate = (_position, _options, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve(false), { once: true }));
		const result = gm.remote.move('obs-utils', '*', { x: 10, duration: 1000 });
		await vi.advanceTimersByTimeAsync(1);
		first.controller.ownership.panic();
		await vi.advanceTimersByTimeAsync(3000);
		const outcomes = await result;
		expect(outcomes.find(user => user.userId === 'gm')).toMatchObject({ status: 'acknowledged', outcomes: [{ status: 'completed' }] });
		expect(outcomes.find(user => user.userId === 'player')?.outcomes).toEqual(expect.arrayContaining([
			expect.objectContaining({ status: 'cancelled', reason: 'panic' }),
			expect.objectContaining({ status: 'completed' }),
		]));
		expect(outcomes.find(user => user.userId === 'silent')?.status).toBe('timeout');
		expect(first.controller.ownership.getClaims()).toHaveLength(0);
		expect(second.adapter.animate).toHaveBeenCalledOnce();
	});

	it('keeps timeout and offline outcomes distinct from acknowledgement', async () => {
		const { gm } = setup();
		const result = gm.remote.move('obs-utils', ['silent', 'offline'], { x: 1 });
		await vi.advanceTimersByTimeAsync(2000);
		expect(await result).toEqual([{ userId: 'silent', status: 'timeout', outcomes: [] }, { userId: 'offline', status: 'offline', outcomes: [] }]);
	});

	it('cancels receivers and does not execute duplicate requests twice', async () => {
		const { gm, first } = setup();
		first.adapter.animate = (_position, _options, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve(false), { once: true }));
		const abort = new AbortController();
		const result = gm.remote.move('obs-utils', 'player', { x: 10, duration: 1000 }, { signal: abort.signal });
		await vi.advanceTimersByTimeAsync(1);
		const packet = gm.emit.mock.calls.find(([packet]) => (packet as { kind: string }).kind === 'request')![0];
		void first.remote.receive(packet, 'gm');
		abort.abort();
		await vi.advanceTimersByTimeAsync(1);
		expect((await result)[0].status).toBe('cancelled');
		expect(first.controller.ownership.getClaims()).toHaveLength(0);
	});

	it('publishes authenticated viewport snapshots and unsubscribes', async () => {
		const { gm, first } = setup();
		const seen = vi.fn();
		const subscription = gm.remote.watch('player', seen);
		expect(seen).toHaveBeenCalledWith({ userId: 'player', sceneId: 'scene', position: { x: 0, y: 0, scale: 1 } });
		first.adapter.pan({ x: 50, y: 5, scale: 2 });
		first.remote.publish();
		await vi.advanceTimersByTimeAsync(33);
		expect(seen).toHaveBeenLastCalledWith({ userId: 'player', sceneId: 'scene', position: { x: 50, y: 5, scale: 2 } });
		subscription.stop();
		seen.mockClear();
		first.remote.publish();
		await vi.advanceTimersByTimeAsync(10000);
		expect(seen).not.toHaveBeenCalled();
		const observingGM = first.remote.watch('gm', seen);
		expect(seen).toHaveBeenCalled();
		observingGM.stop();
		expect((await first.remote.move('obs-utils', 'gm', { x: 1 }))[0].status).toBe('rejected');
	});
});
