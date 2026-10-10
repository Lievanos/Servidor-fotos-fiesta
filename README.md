# Álbum de la fiesta (servidor)

Los invitados abren una página, toman fotos o vídeos y el servidor los guarda en un repositorio **privado** de GitHub. La misma página muestra el álbum.

## 1. Repositorio para las fotos
1. En GitHub crea un repositorio **privado**, por ejemplo `fotos-fiesta`. Márcalo con "Add a README" para que ya tenga la rama `main`.
2. Crea un token: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - *Repository access:* Only select repositories → `fotos-fiesta`.
   - *Permissions → Repository permissions → Contents:* **Read and write**.
   - Copia el token (empieza con `github_pat_`). No lo pegues en ningún archivo ni lo subas a GitHub.

## 2. Repositorio del código
1. Crea otro repositorio, por ejemplo `servidor-fotos-fiesta`, y sube estos archivos (`package.json`, `server.js`, la carpeta `public/`, `.gitignore`).

## 3. Publicarlo en Render (gratis)
1. En render.com: **New → Web Service** y elige `servidor-fotos-fiesta`.
2. *Build Command:* `npm install`  ·  *Start Command:* `npm start`
3. En **Environment** agrega:
   | Variable | Valor |
   |---|---|
   | `GITHUB_TOKEN` | el token del paso 1 |
   | `GITHUB_REPO` | `tu-usuario/fotos-fiesta` |
   | `ACCESS_CODE` | una clave corta, por ejemplo `fiesta2026` (opcional, pero recomendado) |
   | `PARTY_NAME` | el nombre de la fiesta (opcional) |
4. Render te da una dirección como `https://servidor-fotos-fiesta.onrender.com`.

## 4. Para los invitados
Comparte `https://TU-DIRECCION.onrender.com/?c=fiesta2026` (el valor de `ACCESS_CODE`). Pon ese enlace en el QR. Sin el código nadie puede subir; ver el álbum no lo pide.

## Límites a tener en cuenta
- Cada archivo: máximo 25 MB (vídeos de unos 15–20 segundos). Las fotos se reducen a 2000 px antes de subir.
- Plan gratis de Render: se duerme tras 15 min sin visitas y tarda cerca de un minuto en despertar. Ábrelo tú un rato antes de la fiesta.
- GitHub recomienda repositorios de menos de 1 GB. Para unos cientos de fotos va bien.
- El álbum muestra hasta 1000 archivos.
- Las fotos están en la carpeta `fotos/` del repositorio privado; puedes descargarlas con "Code → Download ZIP" o clonándolo.
