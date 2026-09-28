import type { CameraClaim, CameraConsumer, ClaimResult } from './ownership.js';
import { describe, expect, it, vi } from 'vitest';
import { CameraCoordinator } from './ownership.js';

function acquire(consumer: CameraConsumer, user = 'player'): CameraClaim {
	const result = consumer.acquire(user);
	if (!result.ok) throw new Error(`Unexpected rejection: ${result.reason}`);
	return result.claim;
}

function setup() {
	const coordinator = new CameraCoordinator();
	const obs = coordinator.register({ id: 'obs-utils', name: 'OBS Utils', priority: 10 });
	const scenes = coordinator.register({ id: 'scene-states', name: 'Scene States', priority: 20 });
	return { coordinator, obs, scenes };
}

describe('camera ownership', () => {
	it('isolates claims by user and reports immutable snapshots', () => {
		const { coordinator, obs, scenes } = setup();
		acquire(obs, 'stream');
		acquire(scenes, 'player');
		expect(coordinator.getOwner('stream')).toEqual({ consumerId: 'obs-utils', userId: 'stream', priority: 10 });
		expect(coordinator.getClaims()).toHaveLength(2);
		expect(Object.isFrozen(coordinator.getClaims())).toBe(true);
		expect(Object.isFrozen(coordinator.getOwner('stream'))).toBe(true);
		expect(coordinator.getOwner('missing')).toBeUndefined();
	});

	it('preempts lower priorities only after cleanup and makes stale releases harmless', () => {
		const { coordinator, obs, scenes } = setup();
		const old = acquire(obs);
		const cleanup = vi.fn(() => expect(coordinator.getOwner('player')).toBeUndefined());
		old.signal.addEventListener('abort', cleanup, { once: true });
		const replacement = acquire(scenes);
		expect(cleanup).toHaveBeenCalledOnce();
		expect(old.signal.reason).toBe('superseded');
		expect(old.active).toBe(false);
		old.release();
		expect(replacement.active).toBe(true);
		replacement.release();
		replacement.release();
		expect(replacement.signal.reason).toBe('released');
		expect(coordinator.getClaims()).toEqual([]);
	});

	it('rejects equal priority, lower priority, and repeated acquisitions', () => {
		const { coordinator, obs, scenes } = setup();
		const owner = acquire(scenes);
		const equal = coordinator.register({ id: 'equal', name: 'Equal', priority: 20 });
		for (const consumer of [scenes, equal, obs]) {
			expect(consumer.acquire('player')).toEqual({ ok: false, reason: 'busy', owner: coordinator.getOwner('player') });
		}
		expect(owner.active).toBe(true);
	});

	it('applies user overrides before configured defaults before registration priority', () => {
		const { coordinator, obs, scenes } = setup();
		coordinator.setPriorities([
			{ consumerId: 'obs-utils', priority: 5 },
			{ consumerId: 'obs-utils', userId: 'stream', priority: 100 },
		]);
		const player = acquire(obs, 'player');
		const stream = acquire(obs, 'stream');
		acquire(scenes, 'player');
		expect(player.signal.reason).toBe('superseded');
		expect(scenes.acquire('stream')).toMatchObject({ ok: false, reason: 'busy' });
		expect(stream.active).toBe(true);
		expect(coordinator.getConsumers('stream').find(consumer => consumer.id === obs.id)?.priority).toBe(100);
		coordinator.setPriorities([]);
		expect(coordinator.getOwner('stream')?.priority).toBe(10);
		acquire(scenes, 'stream');
		expect(stream.active).toBe(false);
	});

	it('validates overrides atomically without replacing a working configuration', () => {
		const { coordinator } = setup();
		coordinator.setPriorities([{ consumerId: 'obs-utils', priority: 99 }]);
		expect(() => coordinator.setPriorities([
			{ consumerId: 'obs-utils', priority: 0 },
			{ consumerId: 'bad', priority: Number.NaN },
		])).toThrow(RangeError);
		expect(coordinator.getConsumers()[0].priority).toBe(99);
		expect(() => coordinator.setPriorities([
			{ consumerId: 'obs-utils', priority: 0 },
			{ consumerId: 'obs-utils', priority: 1 },
		])).toThrow('Duplicate');
	});

	it('unregisters all claims while stale consumer handles cannot affect a replacement', () => {
		const { coordinator, obs } = setup();
		const one = acquire(obs, 'one');
		const two = acquire(obs, 'two');
		obs.unregister();
		expect(one.signal.reason).toBe('unregistered');
		expect(two.signal.reason).toBe('unregistered');
		const replacement = coordinator.register({ id: obs.id, name: 'OBS Utils' });
		const current = acquire(replacement);
		obs.unregister();
		expect(obs.acquire('player')).toMatchObject({ ok: false, reason: 'unregistered' });
		one.release();
		expect(current.active).toBe(true);
	});

	it('panic blocks a user until explicitly resumed, without disturbing other users', () => {
		const { coordinator, obs, scenes } = setup();
		const player = acquire(obs, 'player');
		const stream = acquire(scenes, 'stream');
		coordinator.panic('player');
		expect(player.signal.reason).toBe('panic');
		expect(stream.active).toBe(true);
		expect(obs.acquire('player')).toEqual({ ok: false, reason: 'disabled' });
		coordinator.resume('player');
		expect(acquire(obs).active).toBe(true);
	});

	it('global panic aborts every claim and global resume preserves local opt-outs', () => {
		const { coordinator, obs, scenes } = setup();
		const one = acquire(obs, 'one');
		const two = acquire(scenes, 'two');
		one.signal.addEventListener('abort', () => expect(coordinator.getClaims()).toEqual([]));
		coordinator.panic();
		expect(one.signal.reason).toBe('panic');
		expect(two.signal.reason).toBe('panic');
		coordinator.panic('one');
		coordinator.resume();
		expect(coordinator.isDisabled('one')).toBe(true);
		expect(coordinator.isDisabled('two')).toBe(false);
		coordinator.resume('one');
		expect(coordinator.isDisabled('one')).toBe(false);
	});

	it('blocks reacquisition during cancellation callbacks', () => {
		const { coordinator, obs, scenes } = setup();
		const old = acquire(obs);
		let reentrant: ClaimResult | undefined;
		old.signal.addEventListener('abort', () => {
			reentrant = scenes.acquire('player');
		});
		coordinator.reset();
		expect(reentrant).toEqual({ ok: false, reason: 'busy' });
		expect(old.signal.reason).toBe('canvas-teardown');
		expect(acquire(scenes).active).toBe(true);
	});

	it.each(['panic', 'dispose', 'unregister'] as const)('respects %s during preemption cleanup', (action) => {
		const { coordinator, obs, scenes } = setup();
		const old = acquire(obs);
		old.signal.addEventListener('abort', () => {
			if (action === 'unregister') scenes.unregister();
			else coordinator[action]();
		});
		expect(scenes.acquire('player')).toMatchObject({ ok: false, reason: { panic: 'disabled', dispose: 'disposed', unregister: 'unregistered' }[action] });
		expect(coordinator.getClaims()).toEqual([]);
	});

	it('does not grant a claim across canvas teardown during preemption', () => {
		const { coordinator, obs, scenes } = setup();
		acquire(obs).signal.addEventListener('abort', () => coordinator.reset());
		expect(scenes.acquire('player')).toEqual({ ok: false, reason: 'canvas-teardown' });
		expect(coordinator.getClaims()).toEqual([]);
		expect(acquire(scenes).active).toBe(true);
	});

	it('cannot resume from a cancellation callback', () => {
		const { coordinator, obs } = setup();
		acquire(obs).signal.addEventListener('abort', () => expect(() => coordinator.resume()).toThrow('Cannot resume'));
		coordinator.panic();
		expect(coordinator.isDisabled()).toBe(true);
	});

	it('reset preserves priorities and panic state; disposal is permanent and idempotent', () => {
		const { coordinator, obs } = setup();
		coordinator.setPriorities([{ consumerId: obs.id, priority: 5 }]);
		const claim = acquire(obs);
		coordinator.panic('other');
		coordinator.reset();
		expect(claim.signal.reason).toBe('canvas-teardown');
		expect(coordinator.isDisabled('other')).toBe(true);
		expect(coordinator.getConsumers()[0].priority).toBe(5);
		const last = acquire(obs);
		coordinator.dispose();
		coordinator.dispose();
		expect(last.signal.reason).toBe('disposed');
		expect(coordinator.getConsumers()).toEqual([]);
		expect(obs.acquire('player')).toEqual({ ok: false, reason: 'disposed' });
		expect(() => coordinator.resume()).toThrow('disposed');
		expect(() => coordinator.register({ id: 'new', name: 'New' })).toThrow('disposed');
	});

	it('keeps a bounded immutable diagnostic history', () => {
		const coordinator = new CameraCoordinator({ diagnosticLimit: 2 });
		const consumer = coordinator.register({ id: 'test', name: 'Test' });
		acquire(consumer).release();
		acquire(consumer);
		const events = coordinator.getDiagnostics();
		expect(events.map(event => event.sequence)).toEqual([2, 3]);
		expect(events.map(event => event.action)).toEqual(['ended', 'acquired']);
		expect(Object.isFrozen(events[0])).toBe(true);
		coordinator.panic();
		expect(events).toHaveLength(2);
		expect(events[1].action).toBe('acquired');
	});

	it('can disable diagnostics', () => {
		const coordinator = new CameraCoordinator({ diagnosticLimit: 0 });
		acquire(coordinator.register({ id: 'test', name: 'Test' })).release();
		expect(coordinator.getDiagnostics()).toEqual([]);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid priority %s', (priority) => {
		expect(() => new CameraCoordinator().register({ id: 'test', name: 'Test', priority })).toThrow(RangeError);
	});

	it('validates IDs, duplicate registration and diagnostic bounds', () => {
		const { coordinator, obs } = setup();
		expect(() => obs.acquire(' ')).toThrow(TypeError);
		expect(() => coordinator.register({ id: '', name: 'Test' })).toThrow(TypeError);
		expect(() => coordinator.register({ id: obs.id, name: 'Test' })).toThrow('already registered');
		expect(() => new CameraCoordinator({ diagnosticLimit: -1 })).toThrow(RangeError);
	});
});
