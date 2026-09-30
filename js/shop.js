/* Official Spreadshop loader, scoped to /tienda/. No tracking or CMP overrides. */
(() => {
  'use strict';
  const shop = document.getElementById('shop');
  if (!shop) return;
  const settings = window.fdcShopSettings;
  const fallback = document.getElementById('shop-fallback');
  const message = document.getElementById('shop-fallback-message');
  const direct = document.getElementById('shop-direct');
  const retry = document.getElementById('shop-retry');
  // Never read the provider from query parameters or user-generated content.
  const valid = settings?.prefix === 'https://fenomenos-media.myspreadshop.com'
    && settings.shopName === 'fenomenos-Media' && settings.shopId === 1976125;
  if (!valid || !settings.enabled) {
    shop.dataset.state = 'unavailable';
    shop.textContent = 'Estamos preparando nuestra tienda. Vuelve pronto para descubrir los productos de Fenómenos Media.';
    return;
  }
  const explorer = document.getElementById('comprar');
  let loaded = false;
  function loadShop() {
    if (loaded) return;
    loaded = true;
    window.spread_shop_config = {
      shopName: settings.shopName,
      prefix: settings.prefix,
      baseId: 'shop',
      updateMetadata: false,
      usePushState: false
      // Locale intentionally omitted: use the shop's own supported language/currency.
    };
    direct.href = settings.prefix;
    direct.hidden = false;
    retry.hidden = false;
    retry.addEventListener('click', () => {
      window.location.hash = 'comprar';
      window.location.reload();
    });
    shop.dataset.state = 'loading';
    shop.setAttribute('aria-busy', 'true');
    // Always retain an escape route after activation; script load alone is not proof
    // that the remote catalog, APIs, product images or checkout are healthy.
    fallback.hidden = false;
    message.textContent = 'Si el catálogo no se muestra o tienes dificultades para comprar, abre la tienda directamente.';
    const observer = new MutationObserver(() => {
      if (shop.childElementCount > 0) {
        window.clearTimeout(timeout);
        delete shop.dataset.state;
        shop.removeAttribute('aria-busy');
        observer.disconnect();
      }
    });
    observer.observe(shop, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => {
      shop.removeAttribute('aria-busy');
      message.textContent = 'Si la tienda sigue sin cargar, puedes abrirla directamente o reintentar.';
    }, 20000);
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = settings.prefix + '/js/shopclient.nocache.js';
    script.onerror = () => {
      window.clearTimeout(timeout);
      observer.disconnect();
      shop.dataset.state = 'error';
      shop.removeAttribute('aria-busy');
      shop.textContent = 'No se pudo cargar el catálogo de Spreadshop.';
      message.textContent = 'Puedes visitar la tienda directamente o volver a intentarlo.';
    };
    document.body.append(script);
  }
  function openShop() {
    if (explorer) explorer.open = true;
    loadShop();
  }
  if (explorer?.tagName === 'DETAILS') {
    explorer.addEventListener('toggle', () => {
      if (explorer.open) loadShop();
    });
    document.querySelectorAll('a[href="#comprar"]').forEach(link => {
      link.addEventListener('click', openShop);
    });
    window.addEventListener('hashchange', () => {
      if (window.location.hash === '#comprar') openShop();
    });
    if (explorer.open || window.location.hash === '#comprar') openShop();
  } else {
    loadShop();
  }
})();
