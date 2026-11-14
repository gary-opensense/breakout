<script>
	import { onMount } from 'svelte';
	import { people, shelf } from './people.js';

	// Logical playfield; everything is scaled to fit the window.
	const W = 1240;
	const H = 1180;
	const UNIT = 20; // one cell of Roam's 62 x 42 floor grid
	const TILE_W = 112;
	const TILE_H = 124;
	const PAD_W = 256;
	const PAD_H = 70;
	const PAD_Y = 1070;
	const BALL_R = 10;
	const START_SPEED = 620;
	const MAX_SPEED = 1050;
	const LIVES = 3;

	// The ball is drawn as this person's avatar (full size); collisions still use BALL_R.
	const BALL_PERSON = 'Amit G';
	const BALL_SIZE = 64;
	const ballImg = people.find((p) => p.label === BALL_PERSON)?.img;

	const initials = (name) =>
		name
			.split(/\s+/)
			.filter((w) => /^[A-Za-z]/.test(w))
			.map((w) => w[0])
			.filter((_, i, a) => i === 0 || i === a.length - 1)
			.join('')
			.toUpperCase();

	let tiles = $state(
		people.map((p, id) => ({
			...p,
			id,
			x: (p.col - 1) * UNIT + 22,
			y: (p.row - 1) * UNIT,
			// unnamed offices are scenery, and the ball's own office is empty (they're out)
			target: !!p.name && !(ballImg && p.label === BALL_PERSON),
			hit: false,
			initials: initials(p.name)
		}))
	);
	let fallers = $state([]);
	let paddleX = $state(W / 2);
	let ball = $state({ x: W / 2, y: PAD_Y - BALL_R, vx: 0, vy: 0 });
	let phase = $state('ready'); // ready | playing | won | lost
	let lives = $state(LIVES);
	let speed = START_SPEED;

	let innerWidth = $state(1240);
	let innerHeight = $state(1180);
	let scale = $derived(Math.min(innerWidth / W, innerHeight / H));

	const total = tiles.filter((t) => t.target).length;
	let gone = $derived(tiles.filter((t) => t.hit).length);

	let status = $derived(
		phase === 'won'
			? 'Office cleared. Happy Friday!'
			: phase === 'lost'
				? 'Back to work. Click to retry'
				: phase === 'ready' && gone === 0 && lives === LIVES
					? 'Click or press Space to start'
					: `${gone} / ${total} sent home`
	);

	let field;
	const keys = { left: false, right: false };
	let fallerId = 0;

	// Sounds live in public/: entered.mp3 plays on each hit, knock.mp3 when the game ends.
	// If a file is missing (e.g. in the svelte.dev playground) a knock is synthesized instead.
	let audio;
	const sounds = {};

	function initAudio() {
		if (audio) return;
		const AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return;
		audio = new AC();
		for (const name of ['entered', 'knock']) {
			fetch(`${name}.mp3`)
				.then((r) => (r.ok && !/html/.test(r.headers.get('content-type') ?? '') ? r.arrayBuffer() : null))
				.then((b) => b && audio.decodeAudioData(b))
				.then((b) => (sounds[name] = b))
				.catch(() => {});
		}
	}

	function rap(at, gain) {
		// body of the knock: a low thump that drops in pitch
		const osc = audio.createOscillator();
		const og = audio.createGain();
		osc.frequency.setValueAtTime(190, at);
		osc.frequency.exponentialRampToValueAtTime(95, at + 0.07);
		og.gain.setValueAtTime(gain, at);
		og.gain.exponentialRampToValueAtTime(0.001, at + 0.11);
		osc.connect(og).connect(audio.destination);
		osc.start(at);
		osc.stop(at + 0.12);

		// knuckle click: a very short band-passed noise burst
		const len = Math.floor(audio.sampleRate * 0.03);
		const buf = audio.createBuffer(1, len, audio.sampleRate);
		const d = buf.getChannelData(0);
		for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
		const src = audio.createBufferSource();
		const bp = audio.createBiquadFilter();
		const ng = audio.createGain();
		src.buffer = buf;
		bp.type = 'bandpass';
		bp.frequency.value = 1100;
		bp.Q.value = 1.2;
		ng.gain.value = gain * 0.7;
		src.connect(bp).connect(ng).connect(audio.destination);
		src.start(at);
	}

	function play(name) {
		if (!audio) return;
		if (audio.state === 'suspended') audio.resume();
		const now = audio.currentTime;
		if (sounds[name]) {
			const src = audio.createBufferSource();
			src.buffer = sounds[name];
			src.connect(audio.destination);
			src.start(now);
		} else {
			rap(now, 0.6);
			rap(now + 0.13, 0.5);
			if (name === 'knock') rap(now + 0.26, 0.5);
		}
	}

	function gameOver(result) {
		phase = result;
		play('knock');
	}

	function reset() {
		for (const t of tiles) t.hit = false;
		fallers = [];
		lives = LIVES;
		speed = START_SPEED;
		phase = 'ready';
	}

	function action() {
		initAudio();
		if (phase === 'ready') {
			const a = (Math.random() * 50 - 25) * (Math.PI / 180);
			ball.vx = speed * Math.sin(a);
			ball.vy = -speed * Math.cos(a);
			phase = 'playing';
		} else if (phase === 'won' || phase === 'lost') {
			reset();
		}
	}

	function knockOut(t) {
		t.hit = true;
		play('entered');
		fallers.push({
			id: fallerId++,
			img: t.img,
			initials: t.initials,
			x: t.x + TILE_W / 2,
			y: t.y + 78,
			vx: ball.vx * 0.25 + (Math.random() - 0.5) * 120,
			vy: -260 - Math.random() * 120,
			rot: 0,
			vr: (Math.random() - 0.5) * 720
		});
		speed = Math.min(MAX_SPEED, speed * 1.015);
		const k = speed / Math.hypot(ball.vx, ball.vy);
		ball.vx *= k;
		ball.vy *= k;
		if (tiles.every((x) => x.hit || !x.target)) gameOver('won');
	}

	function stepBall(dt) {
		ball.x += ball.vx * dt;
		ball.y += ball.vy * dt;

		// walls
		if (ball.x < BALL_R) {
			ball.x = BALL_R;
			ball.vx = Math.abs(ball.vx);
		} else if (ball.x > W - BALL_R) {
			ball.x = W - BALL_R;
			ball.vx = -Math.abs(ball.vx);
		}
		if (ball.y < BALL_R) {
			ball.y = BALL_R;
			ball.vy = Math.abs(ball.vy);
		}

		// the shelf
		if (
			ball.vy > 0 &&
			ball.y + BALL_R >= PAD_Y &&
			ball.y - BALL_R <= PAD_Y + PAD_H * 0.5 &&
			Math.abs(ball.x - paddleX) <= PAD_W / 2 + BALL_R
		) {
			const off = Math.max(-1, Math.min(1, (ball.x - paddleX) / (PAD_W / 2)));
			const a = off * 62 * (Math.PI / 180);
			ball.vx = speed * Math.sin(a);
			ball.vy = -speed * Math.cos(a);
			ball.y = PAD_Y - BALL_R;
			return;
		}

		// offices
		for (const t of tiles) {
			if (t.hit || !t.target) continue;
			const cx = t.x + TILE_W / 2;
			const cy = t.y + TILE_H / 2;
			const ox = TILE_W / 2 + BALL_R - Math.abs(ball.x - cx);
			const oy = TILE_H / 2 + BALL_R - Math.abs(ball.y - cy);
			if (ox <= 0 || oy <= 0) continue;
			if (ox < oy) {
				ball.vx = Math.abs(ball.vx) * Math.sign(ball.x - cx || 1);
				ball.x += ox * Math.sign(ball.x - cx || 1);
			} else {
				ball.vy = Math.abs(ball.vy) * Math.sign(ball.y - cy || 1);
				ball.y += oy * Math.sign(ball.y - cy || 1);
			}
			knockOut(t);
			return;
		}

		// dropped it
		if (ball.y - BALL_R > H) {
			lives -= 1;
			if (lives > 0) phase = 'ready';
			else gameOver('lost');
		}
	}

	function frame(dt) {
		const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
		if (dir) paddleX += dir * 1100 * dt;
		paddleX = Math.max(PAD_W / 2, Math.min(W - PAD_W / 2, paddleX));

		if (phase === 'playing') {
			const steps = Math.max(1, Math.ceil((speed * dt) / 6));
			for (let i = 0; i < steps && phase === 'playing'; i++) stepBall(dt / steps);
		}
		if (phase !== 'playing') {
			ball.x = paddleX;
			ball.y = PAD_Y - (ballImg ? BALL_SIZE / 2 : BALL_R);
		}

		if (fallers.length) {
			for (const f of fallers) {
				f.vy += 2200 * dt;
				f.x += f.vx * dt;
				f.y += f.vy * dt;
				f.rot += f.vr * dt;
			}
			if (fallers.some((f) => f.y > H + 80)) fallers = fallers.filter((f) => f.y <= H + 80);
		}
	}

	onMount(() => {
		let last = performance.now();
		let raf = requestAnimationFrame(function loop(now) {
			frame(Math.min(0.033, (now - last) / 1000));
			last = now;
			raf = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(raf);
	});

	function onKey(e, down) {
		if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = down;
		else if (e.key === 'ArrowRight' || e.key === 'd') keys.right = down;
		else if (down && (e.key === ' ' || e.key === 'Enter') && !e.repeat) action();
		else return;
		e.preventDefault();
	}

	function onPointerMove(e) {
		if (!field) return;
		paddleX = (e.clientX - field.getBoundingClientRect().left) / scale;
	}
</script>

<svelte:window
	bind:innerWidth
	bind:innerHeight
	onkeydown={(e) => onKey(e, true)}
	onkeyup={(e) => onKey(e, false)}
	onpointermove={onPointerMove}
	onpointerdown={(e) => {
		onPointerMove(e);
		action();
	}}
/>

<div class="stage">
	<div
		class="field"
		bind:this={field}
		style="width:{W}px;height:{H}px;transform:translate(-50%,-50%) scale({scale})"
	>
		{#each tiles as t (t.id)}
			<div
				class="office"
				class:hit={t.hit || !t.target}
				class:me={t.label === 'Gary T' && !t.hit}
				style="left:{t.x}px;top:{t.y}px;width:{TILE_W}px;height:{TILE_H}px"
			>
				<span class="name">{t.label}</span>
				{#if t.target && !t.hit}
					{#if t.img}
						<img class="avatar" src={t.img} alt="" draggable="false" />
					{:else}
						<span class="avatar blank">{t.initials}</span>
					{/if}
				{/if}
			</div>
		{/each}

		{#each fallers as f (f.id)}
			<div class="faller" style="transform:translate({f.x - 32}px,{f.y - 32}px) rotate({f.rot}deg)">
				{#if f.img}
					<img class="avatar" src={f.img} alt="" draggable="false" />
				{:else}
					<span class="avatar blank">{f.initials}</span>
				{/if}
			</div>
		{/each}

		{#if ballImg}
			<img
				class="ball face"
				src={ballImg}
				alt=""
				draggable="false"
				style="width:{BALL_SIZE}px;height:{BALL_SIZE}px;transform:translate({ball.x - BALL_SIZE / 2}px,{ball.y -
					BALL_SIZE / 2}px) rotate({ball.x * 1.2}deg)"
			/>
		{:else}
			<div class="ball" style="transform:translate({ball.x - BALL_R}px,{ball.y - BALL_R}px)"></div>
		{/if}

		<div
			class="shelf"
			style="width:{PAD_W}px;height:{PAD_H}px;transform:translate({paddleX - PAD_W / 2}px,{PAD_Y}px)"
		>
			<div class="items">
				{#each shelf as src}
					<img {src} alt="" draggable="false" />
				{/each}
			</div>
			<div class="lip"></div>
		</div>

		<div class="pill">
			<span>{status}</span>
			{#if phase === 'ready' || phase === 'playing'}
				<span class="lives">
					{#each Array(LIVES) as _, i}
						<i class:spent={i >= lives}></i>
					{/each}
				</span>
			{/if}
		</div>
	</div>
</div>

<style>
	:global(html, body) {
		margin: 0;
		height: 100%;
		background: #0b0b0d;
		overflow: hidden;
	}
	.stage {
		position: fixed;
		inset: 0;
		background: #0b0b0d;
		font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		user-select: none;
		touch-action: none;
		cursor: none;
	}
	.field {
		position: absolute;
		left: 50%;
		top: 50%;
		transform-origin: center;
		overflow: hidden;
	}
	.office {
		position: absolute;
		box-sizing: border-box;
		border-radius: 14px;
		background: #1c1d1f;
		border: 2px solid transparent;
	}
	.office.me {
		border-color: #2f7cf6;
	}
	.office.hit {
		background: #141517;
	}
	.name {
		position: absolute;
		left: 13px;
		right: 8px;
		top: 11px;
		font-size: 18px;
		line-height: 1.2;
		color: #f1f1f2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.25s;
	}
	.hit .name {
		color: #3d3e42;
	}
	.avatar {
		display: block;
		width: 64px;
		height: 64px;
		border-radius: 50%;
		object-fit: cover;
	}
	.office .avatar {
		position: absolute;
		left: 50%;
		top: 44px;
		margin-left: -32px;
	}
	.avatar.blank {
		display: grid;
		place-items: center;
		background: #2a2b2e;
		color: #9b9ca1;
		font-size: 22px;
		font-weight: 500;
	}
	.faller,
	.ball,
	.shelf {
		position: absolute;
		left: 0;
		top: 0;
		z-index: 1;
		will-change: transform;
	}
	.ball {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 0 14px 2px rgba(47, 124, 246, 0.9);
	}
	.ball.face {
		background: none;
		object-fit: cover;
		box-shadow: 0 0 0 2px #2f7cf6, 0 0 16px 2px rgba(47, 124, 246, 0.7);
	}
	.items {
		display: flex;
		justify-content: center;
		gap: 10px;
	}
	.items img {
		width: 52px;
		height: 52px;
		border-radius: 8px;
		object-fit: cover;
	}
	.lip {
		height: 18px;
		border-radius: 4px 4px 10px 10px;
		background: #1c1d1f;
		box-shadow: inset 0 1px 0 #2c2d30;
	}
	.pill {
		position: absolute;
		right: 14px;
		bottom: 12px;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 20px;
		border-radius: 12px;
		background: #17181a;
		color: #f1f1f2;
		font-size: 19px;
	}
	.lives {
		display: flex;
		gap: 6px;
	}
	.lives i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #2f7cf6;
	}
	.lives i.spent {
		background: #2a2b2e;
	}
</style>
