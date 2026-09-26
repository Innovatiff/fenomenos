/* Random, gently eased motion for the decorative weather system. */
(() => {
  const traveler = document.querySelector('.fc-traveler');
  const spin = document.querySelector('.fc-spin');
  const field = document.querySelector('.fc-drift');
  if (!traveler || !spin || !field) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const random = (min, max) => min + Math.random() * (max - min);
  const point = () => ({ x: random(.12, .88), y: random(.2, .8) });
  let position = point(), destination = point(), angle = -360;
  let heading = Math.atan2(destination.y - position.y, destination.x - position.x);
  let travelSpeed = .018, targetTravelSpeed = .018, travelTime = 0;
  let speed = 24, targetSpeed = 24, speedTime = 0, fastSpin = false;
  let previous = null, frame = null;
  let width = field.clientWidth, height = field.clientHeight;
  const resize = new ResizeObserver(() => {
    width = field.clientWidth;
    height = field.clientHeight;
  });
  resize.observe(field);

  function tick(now) {
    const dt = previous === null ? 0 : Math.min((now - previous) / 1000, .05);
    previous = now;
    // Travel steers continuously; it never waits for rotation or stops at a waypoint.
    travelTime -= dt;
    if (travelTime <= 0 || Math.hypot(destination.x - position.x, destination.y - position.y) < .09) {
      destination = point();
      targetTravelSpeed = random(.012, .032);
      travelTime = random(8, 17);
    }
    // Turn toward the interior before reaching an edge, without bouncing.
    if (position.x < .08 || position.x > .92 || position.y < .12 || position.y > .88) {
      destination = { x: .5, y: .5 };
    }
    const desiredHeading = Math.atan2(destination.y - position.y, destination.x - position.x);
    const turn = Math.atan2(Math.sin(desiredHeading - heading), Math.cos(desiredHeading - heading));
    heading += Math.max(-.8 * dt, Math.min(.8 * dt, turn));
    travelSpeed += (targetTravelSpeed - travelSpeed) * (1 - Math.exp(-dt / 3));
    position.x += Math.cos(heading) * travelSpeed * dt;
    position.y += Math.sin(heading) * travelSpeed * dt;
    traveler.style.transform = `translate(${position.x * width}px, ${position.y * height}px)`;
    speedTime -= dt;
    if (speedTime <= 0) {
      // Equal-duration slots keep fast-spin selection near 10% of elapsed time.
      fastSpin = Math.random() < .1;
      targetSpeed = fastSpin ? random(240, 360) : random(24, 65);
      speedTime = 10;
    }
    speed += (targetSpeed - speed) * (1 - Math.exp(-dt / (fastSpin ? .8 : 1.4)));
    angle = (angle - speed * dt) % 360;
    spin.style.transform = `rotate(${angle}deg)`;
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    cancelAnimationFrame(frame);
    frame = null;
    previous = null;
    if (reduced.matches) {
      field.classList.remove('fc-drift--random');
      traveler.style.removeProperty('transform');
      spin.style.removeProperty('transform');
      return;
    }
    field.classList.add('fc-drift--random');
    if (!document.hidden) frame = requestAnimationFrame(tick);
  }
  reduced.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  sync();
})();
