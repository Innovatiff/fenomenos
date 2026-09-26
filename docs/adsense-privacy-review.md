# Revisión de privacidad post-migración

La página `/p/privacy.html` se preparó con la implementación actual. Requiere validación del propietario antes de presentarla como política definitiva. No es asesoramiento legal.

| Servicio o dato | Evidencia | Estado |
|---|---|---|
| AdSense y publisher | Script en HTML; `ads.txt`: pub-5012752012707398 | Código verificado; aprobación y configuración del panel no comprobadas |
| Google Analytics | `js/analytics.js`, G-92SH61163V | Carga en dominio público, omitida en localhost |
| Firebase Auth | `js/acceso.js`, registro, contraseña e invitado | Implementado; no se crearon cuentas |
| Cloud Firestore | `js/db.js` y `js/app.js` | Artículos, comentarios, reacciones y ajustes; ninguna escritura realizada |
| Comentarios y correo | `addComment` guarda email; `fetchComments` obtiene documentos aprobados | Revisar reglas/modelo: no prometer confidencialidad solo porque el correo no se dibuje en pantalla |
| Almacenamiento local y caché | `js/app.js`, `js/article-page.js`, `sw.js` | Preferencias, reacciones, comentarios propios, cachés y sesión |
| Consultas de mapas/lugares | Open-Meteo, Photon, Nominatim, mapas y RainViewer en `js/app.js` | Pueden transmitirse coordenadas/términos y datos técnicos a proveedores |
| Recursos externos | Blogger, Google Fonts, unpkg y recursos de redes sociales | Solicitudes externas; derechos/retención propios del proveedor |
| Suscripción por correo | `js/script.js` sin proveedor conectado | Se retiró el formulario de la portada; no hay alta activa |
| Consentimiento | No se encontró integración CMP/Consent Mode en el código revisado | NEEDS_OWNER_REVIEW: el panel podría aportar configuración externa, no comprobada |
| Retención, responsable, región y transferencias | No se determinan con certeza en el código | NEEDS_OWNER_REVIEW; no inventar plazos ni identidad jurídica |

Google exige divulgaciones sobre datos y consentimiento según el uso/región. Para anuncios personalizados en EEE, Reino Unido y Suiza, consultar la [exigencia de CMP certificada](https://support.google.com/adsense/answer/13554116?hl=en) y la [política de consentimiento](https://www.google.com/about/company/user-consent-policy/). La política de privacidad escrita no sustituye estos mecanismos.

No se accedió a AdSense ni se modificaron Firebase, DNS, Blogger, redirecciones o Search Console. No se atribuye el rechazo anterior a los artículos migrados.
