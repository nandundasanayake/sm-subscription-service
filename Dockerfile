# Stage 1: Build static Next.js Admin UI
FROM node:20-alpine AS ui-builder
WORKDIR /app/admin-ui
COPY admin-ui/package*.json ./
RUN npm install
COPY admin-ui/ ./
RUN npm run build

# Stage 2: Final Python environment
FROM python:3.10-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# Copy static export from ui-builder stage
COPY --from=ui-builder /app/admin-ui/out ./admin-ui/out

EXPOSE 8003
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]