"""Render visible catalog and matching JSON-LD from verified public shop data.
Update data/shop-catalog.json after checking Spreadshop, then run this script.
No private API, guessed offers, automatic currency conversion, or hidden copy.
"""
import json
import re
from pathlib import Path
from html import escape
from datetime import date

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / 'data/shop-catalog.json').read_text())
products = data['products']
checked = date.fromisoformat(data['checkedOn'])
months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
checked_label = f'{checked.day} de {months[checked.month-1]} de {checked.year}'
assert products and len({p['url'] for p in products}) == len(products)
items, cards = [], []
for i, p in enumerate(products, 1):
    assert re.fullmatch(r'\d+\.\d{2}', p['price']) and p['currency'] == 'USD'
    assert p['url'].startswith('https://fenomenos-media.myspreadshop.com/')
    assert p['image'].startswith('https://image.spreadshirtmedia.com/')
    assert p['availability'] == 'https://schema.org/InStock'
    name = p['title'] + ' — Huracanes Caribe, logo oficial'
    items.append({'@type': 'ListItem', 'position': i, 'item': {
        '@type': 'Product', 'name': name, 'image': p['image'],
        'description': p['description'], 'url': p['url'],
        'brand': {'@type': 'Brand', 'name': 'Fenómenos Media'},
        'offers': {'@type': 'Offer', 'price': p['price'], 'priceCurrency': 'USD',
                   'availability': p['availability'], 'url': p['url'],
                   'itemCondition': 'https://schema.org/NewCondition'}
    }})
    cards.append(f'''          <li class="shop-product">
            <a href="{escape(p['url'])}" target="_blank" rel="noopener noreferrer">
              <img src="{escape(p['image'])}" alt="{escape(p['alt'])}" width="500" height="500" loading="lazy" decoding="async" />
              <h3>{escape(name)}</h3>
            </a>
            <p>{escape(p['description'])}</p>
            <p class="shop-product-price">US${p['price']} <span>USD</span></p>
            <p class="shop-product-stock">Disponible · impresión bajo pedido</p>
            <a class="shop-product-link" href="{escape(p['url'])}" target="_blank" rel="noopener noreferrer">Ver en Spreadshop ↗</a>
          </li>''')
schema = {'@context': 'https://schema.org', '@type': 'ItemList',
          '@id': 'https://fenomenosdelcaribe.org/tienda/#catalogo',
          'name': 'Productos de Huracanes Caribe — Tienda Fenómenos Media',
          'numberOfItems': len(items), 'itemListElement': items}
markup = '''      <section class="shop-catalog" id="catalogo" aria-labelledby="shop-collection-title">
        <div class="shop-collection">
          <img src="%s" alt="Logo oficial de Huracanes Caribe: símbolo de huracán en azul oscuro" width="300" height="300" />
          <div><p class="shop-eyebrow">Nuestra colección</p><h2 id="shop-collection-title">Huracanes Caribe — Logo oficial</h2>
          <p>El huracán azul oscuro que identifica a nuestra comunidad, ahora en camisetas, sudaderas y accesorios para el día a día. Un diseño sencillo para quienes llevan el Caribe y la meteorología consigo.</p></div>
        </div>
        <p class="shop-catalog-note">%s productos verificados el <time datetime="%s">%s</time>. Precios de referencia en USD para el modelo y color mostrados, sin envío ni impuestos y antes de descuentos promocionales. El precio puede variar por talla o personalización; confirma el total y la disponibilidad al comprar en Spreadshop.</p>
        <ul class="shop-product-grid">
%s
        </ul>
      </section>''' % (escape(data['design']['image']), len(products), data['checkedOn'], checked_label, '\n'.join(cards))
p = ROOT / 'tienda/index.html'
s = p.read_text()
for key, value in [('CATALOG', markup), ('SCHEMA', '<script type="application/ld+json" id="shop-catalog-schema">\n' + json.dumps(schema, ensure_ascii=False, indent=2).replace('<', '\\u003c') + '\n</script>')]:
    pattern = rf'(<!-- SHOP-{key}:START -->).*?(<!-- SHOP-{key}:END -->)'
    assert len(re.findall(pattern, s, re.S)) == 1
    s = re.sub(pattern, lambda m: m[1] + '\n' + value + '\n      ' + m[2], s, flags=re.S)
p.write_text(s)
print(f'Rendered {len(products)} products and matching offers.')
