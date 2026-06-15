# Herramientas

Scripts de utilidad para el repositorio. **No forman parte del runtime** de backend, frontend ni mobile.

```
tools/
├── README.md
└── generate_status_pdf.py   → escribe docs/STATUS.pdf
```

## generate_status_pdf.py

Genera el PDF ejecutivo del estado del proyecto en `docs/STATUS.pdf`.

**Importante:** no lee `docs/STATUS.md` ni convierte Markdown a PDF. El contenido (fases, tests, credenciales, deuda técnica) está definido en el propio script con ReportLab. Si actualizas el estado del proyecto, edita **ambos**:

- `docs/STATUS.md` — versión legible en Markdown
- `tools/generate_status_pdf.py` — versión PDF (datos hardcodeados en Python)

### Requisitos

- Python 3.11+
- [ReportLab](https://www.reportlab.com/) (ya incluido en `backend/requirements.txt`)

### Uso

**Opción A — venv local del backend (recomendado):**

```bash
cd backend
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt   # solo la primera vez

python ../tools/generate_status_pdf.py
```

**Opción B — desde la raíz del repo** (con el venv del backend activo):

```bash
python tools/generate_status_pdf.py
```

### Salida

Siempre escribe en `docs/STATUS.pdf`, relativo a la raíz del repo, sin importar desde qué directorio ejecutes el script.

```bash
# Ejemplo de salida:
PDF generado: /ruta/al/repo/docs/STATUS.pdf
```

## Añadir nuevas herramientas

Coloca scripts en esta carpeta y documenta aquí: propósito, requisitos, comando de ejecución y archivos que generan o modifican.
