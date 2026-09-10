# HARKAT Photobooth 📸

Photobooth web app inspirado del template **HARKAT — Sains Data** (vintage scrapbook, 8 kotak foto, maroon/cream). Foto diambil dari kamera langsung masuk ke **8 kotak** del layout; si solo hay **1 foto**, las 8 cajas se llenan con esa misma foto. Deploy en browser, todo procesado local — **no hay upload**.

## ✨ Funciones

- 📸 **AMBIL FOTO** — camara snap → foto entra al siguiente slot del template (patron zig-zag 2×4)
- 🧩 **Cuantas fotos, cuantos slots**:
  - 1 foto → todas las 8 cajas con esa foto
  - 2 fotos → 4+4
  - 4 fotos → 2+2+2+2
  - 8 fotos → 8 unicas
- 🗑️ Tap **✕** en una caja → borra esa foto y revierte a placeholder
- 🔢 **CETAK** — layout A4 portrait listo para imprimir
- 🎭 **Overlay en vivo** (solo preview, NO en la foto final):
  - Garis wajah (face mesh) — MediaPipe FaceLandmarker 478 landmarks, on-device
  - Emoji emoción dominante + **% match** en tiempo real
  - Marco encuadre cara + línea guía

## 🚀 Runs

```bash
cd harkat-photobooth
python3 -m http.server 8099
# abrir http://localhost:8099
```

Requiere: navegador con cámara (PC/laptop/teléfono). Todo corre 100% local — modelo WebAssembly y fuentes servidos desde `assets/`, cero CDN, funciona offline. Para permiso de cámara en iPhone/teléfono, sirve por HTTPS (o usa el host local con `--allow-insecure-localhost`).

## 🧱 Tech

| Layer | Stack |
|-------|-------|
| Web | HTML/CSS/JS vanilla (sin build) |
| Face | MediaPipe Tasks Vision 0.10.14 (WebAssembly local) |
| Fuentes | Luckiest Guy + Pacifico (self-hosted TTF) |

## 🎨 Estilo

Template original HARKAT: fondo crema texturizado, lineas dashed film-strip, titulares chunky maroon, doodles (✦ ▶ ✕ ♥), firma "Dovey" (crédito por el diseño del template).