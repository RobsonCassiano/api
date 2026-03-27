# Diagnostico: Erro ao Salvar Configurações FedEx

## 📋 Estrutura do Fluxo

```
injected.js (página)
  ↓ saveSettingsButton.onclick()
  └─ readFedexSettingsForm() → { apiKey, secretKey, accountNumber }
  └─ saveFedexSettings(userId, settings)
       ↓ sendMessageToBackground()
       └─ window.postMessage({ type: 'SAVE_FEDEX_SETTINGS', userId, settings, requestId, _fromInjected: true })

content.js (bridge)
  ↓ window.addEventListener('message')
  └─ chrome.runtime.sendMessage(payload)

background.js (service worker)
  ↓ chrome.runtime.onMessage.addListener()
  └─ msg.type === 'SAVE_FEDEX_SETTINGS'
    └─ getCurrentUserId() (se msg.userId não informado)
    └─ backendFetch('PUT', '/api/v1/users/{userId}/fedex-settings', settings)
    └─ safeResponse(sendResponse, { ok: true, data })

server.js (backend)
  ↓ PUT /api/v1/users/:userId/fedex-settings
  └─ Salva em storage/preferences/fedex-settings.json
```

## 🔍 Pontos de Verificação

### 1️⃣ **Etapa: saveFedexSettings (injected.js)**

Abra DevTools (F12) e procure por logs como:

```
📝 [saveFedexSettings] Iniciando salvamento para usuário: gg0ggjlv3u
📦 [saveFedexSettings] Configurações a salvar: { apiKey: "...", secretKey: "...", accountNumber: "232694424" }
📤 [saveFedexSettings] Enviando payload: { type: 'SAVE_FEDEX_SETTINGS', userId: 'gg0ggjlv3u', settings: {...} }
```

**Se não vê esses logs:**
- O onclick do botão não foi acionado
- Ou ocorreu erro antes de saveFedexSettings() ser chamada

**Se vê tudo mas não vê "📨 [saveFedexSettings] Resposta recebida":**
- A mensagem não chegou em content.js
- Ou content.js não retornou a resposta
- Timeout de 10 segundos (verifique se há erro de timeout)

### 2️⃣ **Etapa: Relay em content.js**

Procure por logs como:

```
🌉 [content.js] Relayando mensagem do injected.js: SAVE_FEDEX_SETTINGS requestId: 1711539097894-3a4b5c
🌉 [content.js] Payload detalhado: { type: 'SAVE_FEDEX_SETTINGS', userId: 'gg0ggjlv3u', settings: {...} }
🌉 [content.js] Resposta recebida de background.js: SAVE_FEDEX_SETTINGS { ok: true, data: {...} }
```

**Se não vê "🌉 [content.js] Relayando":**
- content.js não recebeu a mensagem
- Ou a mensagem não passou na validação ALLOWED_MESSAGE_TYPES

**Se vê "Relayando" mas não vê "Resposta recebida":**
- background.js não respondeu
- chrome.runtime.sendMessage falhou

### 3️⃣ **Etapa: Handler em background.js**

Procure por logs como:

```
💾 [SAVE_FEDEX_SETTINGS] Handler iniciado
💾 [SAVE_FEDEX_SETTINGS] msg.userId: gg0ggjlv3u, msg.settings: { apiKey: "...", secretKey: "...", accountNumber: "232694424" }
💾 [SAVE_FEDEX_SETTINGS] userId resolvido: gg0ggjlv3u
💾 [SAVE_FEDEX_SETTINGS] Endpoint: /api/v1/users/gg0ggjlv3u/fedex-settings
💾 [SAVE_FEDEX_SETTINGS] Enviando para backend...
✅ [SAVE_FEDEX_SETTINGS] Configurações salvas no backend: { id: "...", userId: "gg0ggjlv3u", settings: {...} }
```

**Se vê "Handler iniciado" mas não vê "userId resolvido":**
- `getCurrentUserId()` está falhando
- Isso significa que msg.userId é undefined/null E não conseguiu obter do contexto

**Se vê "userId resolvido: null":**
- Crítico! userId não pode ser identificado
- Verifique se cookies estão sendo lidos corretamente

**Se vê "Enviando para backend..." mas não vê "✅":**
- Erro no backendFetch()
- Procure por `❌ [SAVE_FEDEX_SETTINGS] Erro ao salvar: <mensagem de erro>`

## 🚀 Passos para Diagnosticar

1. **Abra DevTools**: F12 na página FedEx
2. **Vá para Console**: Filtre por origem se necessário
3. **Procure pelos 3 estágios acima**
4. **Identifique qual estágio falha**

## 🔧 Possíveis Erros e Soluções

### ❌ "userId não informado para saveFedexSettings"
**Causa**: `saveSettingsButton.onclick` está chamando `saveFedexSettings(null, settings)`
**Solução**: Verifique se `const currentUserId = getCurrentUserId();` retorna valor válido

### ❌ "⏱️ Request timeout: SAVE_FEDEX_SETTINGS"
**Causa**: Nenhuma resposta de content.js dentro de 10 segundos
**Solução**: 
- Verifique se content.js está carregado
- Verifique se ALLOWED_MESSAGE_TYPES inclui 'SAVE_FEDEX_SETTINGS'
- Verifique se background.js está processando `return true;`

### ❌ "Extension context invalidated"
**Causa**: Extension foi recarregada durante a requisição
**Solução**: Recarregue a página FedEx e tente novamente

### ❌ "Usuario nao identificado" (background.js)
**Causa**: msg.userId é null/undefined E `getCurrentUserId()` retorna null
**Solução**: Verifique cookies no backend via `await chrome.cookies.getAll({ url: 'https://www.fedex.com' })`

### ❌ "Network error" ou "Failed to fetch"
**Causa**: Backend não está respondendo em `/api/v1/users/{userId}/fedex-settings`
**Solução**: 
- Inicie o servidor: `npm start`
- Verifique se RENDER_SYNC_BASE_URL em background.js está correto
- Teste endpoint com curl: `curl -X PUT http://localhost:3000/api/v1/users/gg0ggjlv3u/fedex-settings`

## 📝 Exemplo de Teste Manual

```javascript
// Cole no Console do DevTools para testar manualmente:

// 1. Teste sendMessageToBackground
sendMessageToBackground({
  type: 'SAVE_FEDEX_SETTINGS',
  userId: 'gg0ggjlv3u',
  settings: {
    apiKey: 'test-api-key',
    secretKey: 'test-secret-key',
    accountNumber: '232694424'
  }
}).then(resp => console.log('✅ Sucesso:', resp))
  .catch(err => console.error('❌ Erro:', err));

// 2. Espere 15 segundos e verifique logs acima
```

## 📊 Checklist de Verificação

- [ ] Console permite ver logs da página (não há CSP bloqueando)
- [ ] Vejo "📝 [saveFedexSettings] Iniciando..."
- [ ] Vejo "🌉 [content.js] Relayando..."
- [ ] Vejo "💾 [SAVE_FEDEX_SETTINGS] Handler..." em background.js
- [ ] Backend está rodando em http://localhost:3000
- [ ] userId é válido (não é null ou vazio)
- [ ] Settings contém apiKey, secretKey, accountNumber válidos
- [ ] Resposta final é "✅ [saveFedexSettings] Configurações salvas"

## 🎯 Próximos Passos

Após rodar a extensão atualizada:
1. Abra chrome://extensions/
2. Recarregue a extensão (clique no ícone de refresh)
3. Procure pelos logs listados acima
4. Compartilhe a sequência de logs para diagnóstico
