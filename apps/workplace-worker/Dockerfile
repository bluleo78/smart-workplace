FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" pymupdf python-docx openpyxl httpx
COPY app ./app
EXPOSE 7080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7080"]
