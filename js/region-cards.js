(() => {
  const cards = [...document.querySelectorAll('.region-card')];
  function close(card, restoreFocus = false) {
    const toggle = card.querySelector('.region-card__toggle');
    card.querySelector('.region-card__options').hidden = true;
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }
  for (const card of cards) {
    const toggle = card.querySelector('.region-card__toggle');
    const options = card.querySelector('.region-card__options');
    toggle.addEventListener('click', () => {
      cards.forEach(other => { if (other !== card) close(other); });
      toggle.setAttribute('aria-expanded', 'true');
      toggle.hidden = true;
      options.hidden = false;
      options.querySelector('a').focus();
    });
    card.querySelector('.region-card__back').addEventListener('click', () => close(card, true));
    card.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !options.hidden) {
        event.preventDefault();
        close(card, true);
      }
    });
  }
})();
