# FedEx PSDU Integrator - Chrome Extension

Uma extensão do Chrome que integra Shopify com FedEx para automação de envios com suporte a PSDU (Print & Ship Delivery Utility).

## Versão
1.0.0

## Funcionalidades

- ✅ Captura automática de dados de envio do FedEx PSDU
- ✅ Integração com API Shopify para sincronização de pedidos
- ✅ Armazenamento de preferências de impressão
- ✅ Suporte a múltiplas contas FedEx
- ✅ Gerenciamento de credenciais seguro via Chrome Storage

## Requisitos do Sistema

- Chrome 88+
- Acesso às contas FedEx e Shopify
- Backend rodando em: https://fedex-shipping-api.onrender.com (configurável)

## Instalação

### Modo Desenvolvimento

1. Abra `chrome://extensions/`
2. Ative "Modo de desenvolvedor" (canto superior direito)
3. Clique em "Carregar extensão não empacotada"
4. Selecione a pasta `extension/`

### Build para Distribuição

```bash
npm run extension:build
```

Gera arquivo `fedex-psdu-integrator-<version>.zip` pronto para:
- Chrome Web Store
- Distribuição privada
- Instalação corporativa

## Estrutura dos Arquivos

```
extension/
├── manifest.json           # Configuração da extensão
├── background.js           # Service Worker (background)
├── content.js             # Content Script injetado
├── injected.js            # Script injetado na página
├── options.html           # Página de opções (configurações)
├── options.js             # Lógica da página de opções
└── README.md              # Este arquivo
```

## Permissões Utilizadas

| Permissão | Uso |
|-----------|-----|
| `cookies` | Acesso a cookies FedEx para autenticação |
| `storage` | Armazenamento de preferências e configurações |
| `activeTab` | Acesso à aba ativa |
| `scripting` | Execução de scripts nas páginas |
| `clipboardWrite` | Cópia de dados para clipboard |

## Hosts Permitidos

- `https://www.fedex.com/*` - Plataforma FedEx principal
- `https://*.apps.az.fxei.fedex.com/*` - FedEx Apps
- `https://*.myshopify.com/*` - Lojas Shopify
- `https://apis.fedex.com/*` - APIs FedEx
- `https://fedex-shipping-api.onrender.com/*` - Backend customizado

## Configuração

A extensão pode ser configurada através da página de opções:

1. Clique no ícone da extensão
2. Selecione "Opções"
3. Configure:
   - URL do Backend (padrão: https://fedex-shipping-api.onrender.com)
   - Preferências de impressão
   - Credenciais (se necessário)

## Segurança

- Credenciais são armazenadas localmente via Chrome Storage API
- Nenhum dado sensível é armazenado em servidores externos
- HTTPS obrigatório para todas as comunicações
- Permissões seguem princípio de mínimo privilégio (Manifesto v3)

## Troubleshooting

### "Erro ao carregar injected.js"
- Verifique se todos os arquivos estão na pasta
- Verifique `web_accessible_resources` no manifest.json

### Extensão não captura dados
- Verifique se está na página correta (FedEx PSDU)
- Abra DevTools (F12) e verifique console para erros
- Verifique permissões no manifest.json

### Cookies não sincronizam
- Verifique permissão `cookies` no manifest.json
- Confirme que está autenticado no FedEx
- Verifique se URLs em `FEDEX_COOKIE_URLS` estão corretas

## Desenvolvimento

Para desenvolvimentos futuros:

```bash
npm run dev              # Inicia backend em modo desenvolvimento
npm run extension:watch  # Monitora mudanças na extensão
```

## Controle de Versão

Atualize o campo `version` em ambos:
- `extension/manifest.json`
- `package.json`

## Empacotamento

Após testes completos:

```bash
npm run extension:build
```

O arquivo ZIP gerado pode ser:
- Enviado ao Chrome Web Store
- Distribuído via MDM (Mobile Device Management)
- Instalado manualmente em corporações

## Suporte

Para bugs ou questões:
1. Verifique o console do Chrome (F12)
2. Examine os logs do Service Worker
3. Consulte a seção Troubleshooting

## Licença

ISC

## Autor

Automação Brazil
