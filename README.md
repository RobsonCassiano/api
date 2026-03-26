# FedEx Shipping API

API Node.js para integracao entre Shopify e FedEx, organizada para deploy no Render.

## Estrutura

```text
.
|-- extension/
|   |-- background.js
|   |-- content.js
|   |-- injected.js
|   `-- manifest.json
|-- src/
|   |-- server/
|   |   |-- clients/
|   |   |-- controllers/
|   |   |-- middlewares/
|   |   |-- routes/
|   |   |-- services/
|   |   |-- utils/
|   |   `-- server.js
|   `-- shared/
|       `-- shipmentTypes.js
|-- storage/
|   `-- .gitkeep
|-- .env.example
|-- .gitignore
|-- package.json
|-- README.md
`-- render.yaml
```

## Rodando localmente

```powershell
Copy-Item .env.example .env
npm install
npm.cmd start
```

Para desenvolvimento:

```powershell
npm.cmd run dev
```

## Deploy no Render

- O backend sobe com `npm start`.
- O health check esta em `GET /health`.
- O arquivo `render.yaml` ja define o web service e um disco persistente para os drafts.
- Configure no Render as variaveis listadas em `.env.example`.

## Extensao Chrome

Se a extensao continuar fazendo parte do fluxo:

1. Abra `chrome://extensions`
2. Ative o modo desenvolvedor
3. Clique em carregar extensao nao empacotada
4. Selecione a pasta `extension`

## Endpoints principais

- `GET /health`
- `POST /api/v1/fedex/shipments`
- `GET /api/v1/fedex/tracking/:trackingNumber`
- `POST /api/v1/drafts/save`
- `GET /api/v1/drafts`
- `POST /api/v1/drafts/:id/send-to-fedex`
- `GET /api/v1/users/:userId/print-preferences`
- `POST /api/v1/orders/process`
- `GET /api/v1/shopify/orders`

## Observacoes

- `.env` continua fora do versionamento.
- Os drafts agora ficam em `storage/drafts` localmente ou no caminho definido por `DRAFTS_DIR`.
- Para o Render, use disco persistente se quiser manter drafts entre deploys e reinicios.
