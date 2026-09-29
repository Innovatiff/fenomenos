/* Map URLs recovered from the legacy analysis pages. */
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
      },
      {
        "label": "96 horas",
        "url": "https://ocean.weather.gov/shtml/A_96hrsfc.gif",
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
  }
};
const categories = document.getElementById('analysis-categories');
if (!categories) return;
const regions = document.getElementById('analysis-regions');
const products = document.getElementById('analysis-products');
const canvas = document.getElementById('analysis-canvas');
const status = document.getElementById('analysis-status');
let category = Object.keys(DATA)[0], region = Object.keys(DATA[category])[0], selected = 0, request = 0;
function buttons(container, labels, active, choose) {
  container.replaceChildren();
  labels.forEach((label,i)=>{
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'analysis-option';
    button.textContent = label; button.setAttribute('aria-pressed', String(i === active));
    button.addEventListener('click',()=>{
      [...container.children].forEach(el=>el.setAttribute('aria-pressed',String(el===button)));
      choose(i);
    });
    container.append(button);
  });
}
function showMap(){
  const product = DATA[category][region][selected], token = ++request;
  const label = `${category} · ${region} · ${product.label}`;
  document.getElementById('analysis-label').textContent=label;
  document.getElementById('analysis-source').textContent=product.source;
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
  buttons(products,DATA[category][region].map(p=>p.label),selected,i=>{selected=i;showMap();});showMap();
}
function renderRegions(){
  const names=Object.keys(DATA[category]);
  buttons(regions,names,names.indexOf(region),i=>{region=names[i];selected=0;renderProducts();});renderProducts();
}
const names=Object.keys(DATA);
buttons(categories,names,0,i=>{category=names[i];if(!DATA[category][region])region=Object.keys(DATA[category])[0];selected=0;renderRegions();});
renderRegions();
})();
