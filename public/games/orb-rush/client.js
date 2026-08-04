// Orb Rush client - reference implementation for real-time games.
// Renders interpolated server snapshots and streams an input vector upstream.

import { createStage, createLoop, createInput, createInterpolator, lerp } from '/js/engine.js';
import { Sound } from '/js/sound.js';
import { floatText } from '/js/fx.js';

const SEND_HZ = 15;

export default {
  mount({ canvas, wrap, hud, Net }) {
    const stage = createStage(canvas, { w: 1000, h: 600 });
    const input = createInput(wrap, { stick: true });
    const interp = createInterpolator(110);

    hud.innerHTML = `
      <span class="chip">⏱ <b id="clock">60</b>s</span>
      <span class="chip">⚡ <b id="myScore">0</b></span>
      <span class="chip" id="lead"></span>`;
    const clockEl = hud.querySelector('#clock');
    const scoreEl = hud.querySelector('#myScore');
    const leadEl = hud.querySelector('#lead');

    const offState = Net.on('game:state', (s) => interp.push(s));

    let sendAcc = 0;
    let lastSent = { x: 0, y: 0 };
    let myScore = -1;
    let lastClock = -1;

    const loop = createLoop((dt) => {
      // --- input -> server -------------------------------------------------
      sendAcc += dt;
      const axis = input.axis();
      const changed = Math.abs(axis.x - lastSent.x) > 0.02 || Math.abs(axis.y - lastSent.y) > 0.02;
      if (sendAcc >= 1 / SEND_HZ && changed) {
        sendAcc = 0;
        lastSent = axis;
        Net.action({ type: 'move', dx: axis.x, dy: axis.y });
      }

      // --- render ----------------------------------------------------------
      const frame = interp.sample();
      stage.clear('#07061a');
      if (!frame) return;
      const { a, b, t } = frame;

      stage.drawWorld((ctx) => {
        drawFloor(ctx, a.world);

        for (const orb of b.orbs) {
          const glow = orb.value > 1 ? '#ffd166' : '#4ad6ff';
          ctx.save();
          ctx.shadowBlur = 24;
          ctx.shadowColor = glow;
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(orb.x, orb.y, orb.value > 1 ? 15 : 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        const prev = new Map(a.players.map((p) => [p.id, p]));
        for (const p of b.players) {
          if (!p.alive) continue;
          const from = prev.get(p.id) ?? p;
          const x = lerp(from.x, p.x, t);
          const y = lerp(from.y, p.y, t);
          const isMe = p.id === Net.playerId;

          ctx.save();
          ctx.shadowBlur = isMe ? 26 : 12;
          ctx.shadowColor = p.color;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(x, y, 18, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          if (isMe) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y, 23, 0, Math.PI * 2);
            ctx.stroke();
          }

          ctx.fillStyle = '#eceafb';
          ctx.font = '600 15px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(p.name, x, y - 28);
        }
      });

      // --- hud -------------------------------------------------------------
      clockEl.textContent = b.timeLeft;
      const me = b.players.find((p) => p.id === Net.playerId);
      scoreEl.textContent = me?.score ?? 0;

      // A score jump means I just ate an orb — the jump size tells me which kind.
      if (me && myScore >= 0 && me.score > myScore) {
        const gained = me.score - myScore;
        Sound.play('orb', { value: gained });
        floatText(scoreEl, `+${gained}`);
      }
      if (me) myScore = me.score;

      // Last five seconds of the round.
      if (b.timeLeft !== lastClock) {
        if (b.timeLeft <= 5 && b.timeLeft > 0) Sound.play('tick-urgent');
        lastClock = b.timeLeft;
      }
      const top = [...b.players].sort((x, y) => y.score - x.score)[0];
      leadEl.textContent = top ? `👑 ${top.name} ${top.score}` : '';
    });

    loop.start();

    return () => {
      loop.stop();
      offState();
      input.destroy();
      stage.destroy();
      hud.innerHTML = '';
    };
  },
};

function drawFloor(ctx, world) {
  ctx.fillStyle = '#0d0b24';
  ctx.fillRect(0, 0, world.w, world.h);
  ctx.strokeStyle = 'rgba(124, 92, 255, 0.13)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= world.w; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, world.h);
    ctx.stroke();
  }
  for (let y = 0; y <= world.h; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(world.w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(124, 92, 255, 0.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, world.w - 3, world.h - 3);
}
