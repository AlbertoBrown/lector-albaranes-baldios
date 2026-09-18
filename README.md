# Lector de albaranes Baldíos · Scanlitros

Lector local de cliente, litros, fecha y hora de entrega para notas de entrega de Combustibles Los Baldíos.

## Uso

1. Abre un PDF o una imagen.
2. La opción inicial «PDF con texto · sin OCR ni IA» extrae el texto con PDF.js.
3. Para una foto o un PDF escaneado, elige «Automática + OCR local para fotos».
4. Revisa y corrige el nombre, los litros, la fecha y la hora de entrega. Marca la casilla de revisión para copiar o descargar el CSV.

Los archivos se procesan en el navegador. No se envían a APIs ni se guardan en servidores. Los campos y documentos se pierden al recargar; descarga el resultado antes de cerrar. El CSV contiene cliente, litros, fecha de entrega (DD/MM/AAAA) y hora de entrega de la página seleccionada y está preparado para Excel en español.

La extracción determinista prioriza `(4c) Nombre` y `(5b) Cantidad`, comprobando el bloque inferior `Datos cliente`. La fecha y la hora proceden exclusivamente del apartado `(6g) Fecha de entrega`; se conservan como figuran, sin conversión de zona horaria. Las fechas inválidas o campos ausentes quedan vacíos para completarlos manualmente. Nunca utiliza el receptor como cliente ni suma las cantidades repetidas. Si hay varias filas o cantidades contradictorias, solicita revisión manual. Se permiten hasta 25 MB por archivo.

El modo OCR usa Tesseract.js con el modelo de español y reconocimiento LSTM: no es IA generativa, pero sí utiliza un modelo entrenado de reconocimiento. Para cero IA, utiliza la lectura directa de PDF o el modo manual. Fotografías torcidas, desenfocadas, manuscritas o de otros formatos pueden requerir corrección.

## Estructura

- `dist/index.html`, `dist/styles.css`: interfaz adaptable.
- `dist/app.mjs`: lectura, vista previa, OCR opcional y exportación.
- `dist/extractor.mjs`: extracción por etiquetas y posición, reglas de cantidades y CSV.
- `dist/vendor`: PDF.js 5.6.205, Tesseract.js 7.0.0, Tesseract.js Core 7.0.0 y modelo español tessdata_fast.

## Instalación y ejecución

Necesitas Node.js 22.13 o superior y npm. Desde una terminal:

```bash
git clone https://github.com/AlbertoBrown/lector-albaranes-baldios.git
cd lector-albaranes-baldios
npm ci
npm run build
npm start
```

Abre http://localhost:3000. El servidor de desarrollo escucha solo en tu equipo. Puedes cambiar el puerto con la variable `PORT`.

La instalación y la primera preparación necesitan Internet para descargar las dependencias y el modelo español. `npm run build` copia las versiones fijadas de PDF.js y Tesseract en `dist/vendor`, descarga el modelo desde un commit fijo y verifica su SHA-256. Las librerías generadas no se guardan en Git. Después, el procesamiento de documentos se realiza localmente y no llama a servicios externos.

Para publicar, ejecuta `npm ci` y `npm run build` y sirve la carpeta `dist` en cualquier alojamiento estático HTTPS. No abras `index.html` con `file://`: los módulos y trabajadores necesitan HTTP(S).

El PDF real de referencia se utiliza exclusivamente para validación y no se incluye en el sitio ni en el repositorio.

## Dependencias y licencias

PDF.js, Tesseract.js y Tesseract.js Core se distribuyen bajo Apache 2.0; las licencias se incluyen en `dist/vendor`. Modelo español obtenido de `tesseract-ocr/tessdata_fast`, Apache 2.0. No se utilizan recursos de CDN durante la lectura.
