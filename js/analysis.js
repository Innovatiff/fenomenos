/* Map URLs recovered from the legacy analysis pages.
 * Surface 96h temporarily omitted: NOAA suspension, https://www.weather.gov/marine/pns26-61
 * Verify a current chart before restoring it; an HTTP 200 may be an unavailable-product image.
 */
(()=>{
const DATA = {
  "Análisis de superficie": {
    "Atlántico Norte": [
      {
        "label": "Inicial",
        "url": "https://ocean.weather.gov/A_sfc_full_ocean_color.png",
        "source": "NOAA · OPC"
      },
      {
        "label": "24 horas",
        "url": "https://ocean.weather.gov/shtml/A_24hrsfc.gif",
        "source": "NOAA · OPC"
      },
      {
        "label": "48 horas",
        "url": "https://ocean.weather.gov/shtml/A_48hrsfc.gif",
        "source": "NOAA · OPC"
      }
    ],
    "Caribe": [
      {
        "label": "Inicial",
        "url": "https://www.nhc.noaa.gov/tafb_latest/CAR_latest.gif",
        "source": "NOAA · NHC"
      }
    ],
    "Atlántico tropical": [
      {
        "label": "24 horas",
        "url": "https://www.nhc.noaa.gov/tafb_latest/atlsfc24_latestBW.gif",
        "source": "NOAA · NHC"
      },
      {
        "label": "48 horas",
        "url": "https://www.nhc.noaa.gov/tafb_latest/atlsfc48_latestBW.gif",
        "source": "NOAA · NHC"
      },
      {
        "label": "72 horas",
        "url": "https://www.nhc.noaa.gov/tafb_latest/atlsfc72_latestBW.gif",
        "source": "NOAA · NHC"
      }
    ]
  },
  "Análisis en altura": {
    "Atlántico Norte": [
      {
        "label": "Inicial · 500 hPa",
        "url": "https://ocean.weather.gov/shtml/A_00hr500.gif",
        "source": "NOAA · OPC"
      },
      {
        "label": "24 horas · 500 hPa",
        "url": "https://ocean.weather.gov/shtml/A_24hr500.gif",
        "source": "NOAA · OPC"
      },
      {
        "label": "48 horas · 500 hPa",
        "url": "https://ocean.weather.gov/shtml/A_48hr500.gif",
        "source": "NOAA · OPC"
      },
      {
        "label": "96 horas · 500 hPa",
        "url": "https://ocean.weather.gov/shtml/A_96hr500.gif",
        "source": "NOAA · OPC"
      }
    ]
  },
  "Temperatura del mar": {
    "Atlántico tropical": [
      {
        "label": "Promedio semanal",
        "url": "https://www.nhc.noaa.gov/tafb/atl_anal.gif",
        "source": "NOAA · NHC"
      },
      {
        "label": "Anomalía semanal",
        "url": "https://www.nhc.noaa.gov/tafb/atl_anom.gif",
        "source": "NOAA · NHC"
      },
      {
        "label": "Temperatura CDAS",
        "url": "https://www.tropicaltidbits.com/analysis/ocean/cdas-sflux_sst_atl_1.png",
        "source": "Tropical Tidbits · CDAS"
      },
      {
        "label": "Anomalía CDAS",
        "url": "https://www.tropicaltidbits.com/analysis/ocean/cdas-sflux_ssta_atl_1.png",
        "source": "Tropical Tidbits · CDAS"
      },
      {
        "label": "Temperatura NESDIS",
        "url": "https://www.ospo.noaa.gov/data/sst/contour/usatlant.fc.gif",
        "source": "NOAA · NESDIS"
      }
    ],
    "Caribe": [
      {
        "label": "Temperatura CDAS",
        "url": "https://www.tropicaltidbits.com/analysis/ocean/cdas-sflux_sst_watl_1.png",
        "source": "Tropical Tidbits · CDAS"
      },
      {
        "label": "Anomalía CDAS",
        "url": "https://www.tropicaltidbits.com/analysis/ocean/cdas-sflux_ssta_watl_1.png",
        "source": "Tropical Tidbits · CDAS"
      }
    ]
  },
  "Contenido calórico": {
    "Atlántico": [
      {
        "label": "Contenido de calor oceánico",
        "url": "https://isotherm.rsmas.miami.edu/heat/images/ohc_aQG3_latest_natl.gif",
        "source": "Universidad de Miami"
      }
    ]
  },
  "Cizalladura del viento": {
    "Atlántico tropical": [
      {
        "label": "Cizalladura vertical",
        "url": "https://tropic.ssec.wisc.edu/real-time/atlantic/winds/wg8shr.GIF",
        "source": "UW–CIMSS",
        "description": "Diferencia del viento entre niveles de la atmósfera. Consulta la escala y los niveles indicados en el mapa."
      }
    ]
  },
  "Satélite y humedad": {
    "Atlántico tropical": [
      {
        "label": "Vapor de agua · niveles altos",
        "url": "https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/taw/08/latest.jpg",
        "source": "NOAA · GOES-19",
        "description": "Canal 8: muestra patrones de humedad en niveles altos; no representa la humedad en superficie."
      },
      {
        "label": "Infrarrojo · nubes",
        "url": "https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/taw/13/latest.jpg",
        "source": "NOAA · GOES-19",
        "description": "Canal 13: temperatura de brillo para observar la nubosidad tanto de día como de noche."
      },
      {
        "label": "GeoColor",
        "url": "https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/taw/GEOCOLOR/latest.jpg",
        "source": "NOAA · GOES-19",
        "description": "Composición satelital para observar nubes y sistemas sobre el Atlántico tropical."
      }
    ]
  }
};
const categories = document.getElementById('analysis-categories');
if (!categories) return;
const regions = document.getElementById('analysis-regions');
const products = document.getElementById('analysis-products');
const canvas = document.getElementById('analysis-canvas');
const status = document.getElementById('analysis-status');
let category = Object.keys(DATA)[0], region = Object.keys(DATA[category])[0], selected = 0, request = 0;
function fillSelect(container, labels, active) {
  container.replaceChildren(...labels.map((label,i)=>{
    const option = document.createElement('option');
    option.value = String(i); option.textContent = label; option.selected = i === active;
    return option;
  }));
}
function showMap(){
  const product = DATA[category][region][selected], token = ++request;
  const label = `${category} · ${region} · ${product.label}`;
  document.getElementById('analysis-label').textContent=label;
  document.getElementById('analysis-source').textContent=product.source;
  const description = document.getElementById('analysis-description');
  description.textContent = product.description || '';
  description.hidden = !product.description;
  document.getElementById('analysis-open').href=product.url;
  canvas.querySelector('img')?.remove();
  status.hidden=false; status.textContent='Cargando mapa…'; canvas.setAttribute('aria-busy','true');
  const img = new Image(); img.alt=label; img.hidden=true;
  const timer=setTimeout(()=>finish(false),20000);
  let finished=false;
  function finish(ok){
    if(finished || token!==request) {clearTimeout(timer);return;}
    finished=true;clearTimeout(timer);canvas.setAttribute('aria-busy','false');
    if(ok){img.hidden=false;status.hidden=true;}
    else {img.remove();status.textContent='No se pudo cargar este mapa. Puedes abrirlo directamente en la fuente o seleccionar otro producto.';}
  }
  img.onload=()=>finish(true);img.onerror=()=>finish(false);
  canvas.append(img);img.src=product.url;
}
function renderProducts(){
  fillSelect(products,DATA[category][region].map(p=>p.label),selected);showMap();
}
function renderRegions(){
  const names=Object.keys(DATA[category]);
  fillSelect(regions,names,names.indexOf(region));renderProducts();
}
const names=Object.keys(DATA);
fillSelect(categories,names,0);
categories.addEventListener('change',()=>{
  category=names[Number(categories.value)];
  if(!DATA[category][region])region=Object.keys(DATA[category])[0];
  selected=0;renderRegions();
});
regions.addEventListener('change',()=>{region=Object.keys(DATA[category])[Number(regions.value)];selected=0;renderProducts();});
products.addEventListener('change',()=>{selected=Number(products.value);showMap();});
renderRegions();
})();
