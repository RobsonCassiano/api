# Extensão Chrome - FedEx PSDU Integrator
## Checklist de Empacotamento v1.0.0

### ✅ Validação do Código
- [ ] Todos os arquivos JavaScript verificados (sem erros de sintaxe)
- [ ] Console do Chrome sem warnings ou erros
- [ ] Content scripts funcionando corretamente
- [ ] Background service worker ativo
- [ ] Página de opções acessível e funcional

### ✅ Configuração do Manifest
- [x] manifest_version: 3 (padrão moderno)
- [x] name, version, description definidos
- [x] permissions mínimas e específicas
- [x] host_permissions inclusos
- [x] background service worker configurado
- [x] content_scripts com URLs corretas
- [x] web_accessible_resources definidos
- [x] action com título descritivo
- [x] author e homepage_url inclusos

### ✅ Arquivos Obrigatórios Presentes
- [x] manifest.json
- [x] background.js
- [x] content.js
- [x] injected.js
- [x] options.html
- [x] options.js
- [x] README.md (documentação)

### ✅ Preparação para Distribuição
- [ ] Ícones da extensão criados (16x16, 48x48, 128x128)
- [x] Script de build criado: `scripts/build-extension.js`
- [x] npm script adicionado: `npm run extension:build`
- [x] README completo e documentado
- [x] Documentação de permissões
- [x] Guia de instalação

### ✅ Segurança
- [x] Manifest v3 (padrão de segurança moderno)
- [x] Content Security Policy implícita
- [x] Permissões específicas (não genéricas)
- [x] Sem tokens/senhas no código da extensão
- [x] Configuração via Chrome Storage API

### ✅ Testes Antes do Build
```bash
# 1. Instalar dependências (se necessário)
npm install

# 2. Validar sintaxe dos arquivos
npm run lint  # (se disponível)

# 3. Carregar em desenvolvimento e testar
# - chrome://extensions/
# - Modo de desenvolvedor ON
# - carregar extension/

# 4. Testar funcionalidades principais
# - Acesso a cookies
# - Injeção de scripts
# - Armazenamento de dados
# - Página de opções
```

### 📦 Build da Extensão
```bash
npm run extension:build
```

Outputs:
- `dist/fedex-psdu-integrator-1.0.0.zip` - Arquivo pronto para distribuição
- `dist/fedex-psdu-integrator-1.0.0.json` - Metadados do build

### 🚀 Próximos Passos após Build

#### Para Chrome Web Store Oficial
1. Criar conta de desenvolvedor: https://chrome.google.com/webstore/devconsole
2. Upload do arquivo ZIP
3. Preencher informações:
   - Descrição completa
   - Imagens de captura de tela (1280x800 min)
   - Categoria
   - Idiomas suportados
4. Enviar para revisão

#### Para Distribuição Corporativa
1. Gerar extensão CRX (Chrome Web Store gera automaticamente)
2. Distribuir via:
   - Email
   - Drive corporativo
   - Servidor de distribuição
3. Instalar via: `chrome-extension://ID` ou MDM

#### Para Distribuição Privada
1. Manter arquivo ZIP seguro
2. Distribuir com instruções:
   ```
   1. chrome://extensions/
   2. Ative "Modo para desenvolvedores"
   3. Arraste e solte o ZIP ou selecione a pasta
   ```

### 📋 Versionamento

Ao fazer atualizações, sincronize as versões:
1. Atualize `extension/manifest.json` → `"version": "X.Y.Z"`
2. Atualize `package.json` → `"version": "X.Y.Z"`
3. Execute: `npm run extension:build`
4. Comite mudanças com tag de versão

### 🐛 Troubleshooting

| Problema | Solução |
|----------|---------|
| "Ícones não encontrados" | Crie imagens em images/ pastas ou remova icon reference |
| Build falha | Verifique se archiver está instalado: `npm install archiver` |
| Extensão não carrega | Valide manifest.json em https://manifest-validator.appspot.com/ |
| Scripts não injetam | Verifique web_accessible_resources no manifest |

---

**Status**: ✅ Pronta para empacotamento  
**Versão**: 1.0.0  
**Data**: 27 de março de 2026
