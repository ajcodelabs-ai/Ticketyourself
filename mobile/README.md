# TYS Mobile

App de validación de tickets en puerta. Construida con Expo 54 + React Native. Escanea QR y consulta el backend para aprobar o rechazar entradas en tiempo real.

## Requisitos

- Node.js 18+
- Yarn 1.x
- Expo Go app instalada en el dispositivo (para pruebas físicas)
- Simulador iOS (Xcode) o emulador Android (Android Studio) para pruebas locales

## Instalación y arranque

```bash
cd mobile
yarn install

# Variables de entorno
echo "EXPO_PUBLIC_BACKEND_URL=http://localhost:8000" > .env

yarn start          # abre Expo DevTools en el navegador
```

Luego escanear el QR con Expo Go, o presionar:
- `i` — abrir en simulador iOS
- `a` — abrir en emulador Android
- `w` — abrir en navegador web

## Variables de entorno (`mobile/.env`)

```env
# URL base del backend accesible desde el dispositivo
# En dispositivo físico usar la IP local (no localhost)
EXPO_PUBLIC_BACKEND_URL=http://192.168.x.x:8000
```

> En simulador/emulador `localhost` funciona. En dispositivo físico hay que usar la IP de la máquina en la red local.

## Comandos disponibles

```bash
yarn start          # servidor Expo (modo interactivo)
yarn ios            # simulador iOS
yarn android        # emulador Android
yarn web            # navegador web
yarn lint           # ESLint
```

## Estructura

```
app/
  index.tsx         pantalla principal (splash / entrada a la app)
  +html.tsx         shell HTML para modo web

assets/
  images/           íconos y splash screen
```

## Tecnologías principales

| Paquete | Uso |
|---------|-----|
| `expo-router` | Navegación basada en archivos |
| `react-native-webview` | Embeber interfaces web del backend |
| `expo-camera` / `html5-qrcode` | Escaneo QR |
| `react-native-reanimated` | Animaciones fluidas |
| `expo-haptics` | Feedback táctil en validación |

## Validación de tickets

El flujo de validación llama a `POST /api/tickets/validate` con el payload del QR escaneado. El backend verifica la firma JWT del ticket y retorna el estado: `valid`, `already_used` o `invalid`.
