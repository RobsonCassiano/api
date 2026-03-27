# Guia de Distribuição - FedEx PSDU Integrator

## 📦 Arquivo Gerado
- **Nome**: `fedex-psdu-integrator-1.0.0.zip`
- **Localização**: `dist/`
- **Tamanho**: ~23 KB
- **Status**: ✅ Pronto para distribuição

---

## 1️⃣ Instalação Básica (Desenvolvimento)

Para carregar a extensão localmente sem empacotar:

1. Abra `chrome://extensions/`
2. Ative **"Modo de desenvolvedor"** (canto superior direito)
3. Clique em **"Carregar extensão não empacotada"**
4. Selecione a pasta `extension/`

---

## 2️⃣ Chrome Web Store (Distribuição Oficial)

### Pré-requisitos
- Conta Google
- Taxa de desenvolvimento ($5 USD, pagamento único)
- Extensão testada e funcionante

### Processo
1. Acesse [Chrome Web Store Developer Console](https://chrome.google.com/webstore/devconsole)
2. Clique em **"Novo item"**
3. Selecione o arquivo ZIP: `fedex-psdu-integrator-1.0.0.zip`
4. Preencha:
   - ✅ **Nome da extensão**: FedEx PSDU Integrator
   - ✅ **Descrição**: Shopify to FedEx integration with PSDU support
   - ✅ **Categoria**: Produtividade
   - ✅ **Idiomas**: Português (Brasil)
   - ❌ **URLs**: (deixe em branco se não tiver site)

5. Adicione **imagens**:
   - **Ícone de 128x128** (obrigatório)
   - **Screenshot 1280x800+** (recomendado 2-5 imagens)
   - **Small tile 440x280** (opcional)

6. Configure **seção de dados do formulário**:
   - Provedor de conteúdo externo: SIM (se usar APIs)
   - Descrição detalhada do funcionamento
   - URLs de cookies terceirizados

7. **Submeta para revisão**
   - Tempo de revisão: 1-3 dias
   - Possíveis motivos de rejeição:
     - Permissões não justificadas
     - Comportamento enganoso
     - Privacidade inadequada

---

## 3️⃣ Distribuição Corporativa (MDM)

Para empresas que querem distribuir internamente:

### Opção A: Instalação via URL Privada
1. Upload do arquivo ZIP em servidor corporativo (HTTPS)
2. Criar script de instalação:
```powershell
# Windows
reg add "HKLM\Software\Google\Chrome\Extensions\EXTENSION_ID" /v update_url /t REG_SZ /d "file:///server/path/updates.xml"
```

### Opção B: Instalação via Arquivo CRX
1. Gerar arquivo CRX (Chrome Web Store faz automaticamente após submissão)
2. Distribuir `.crx` com script de instalação

### Opção C: Instalação em Massa (Intune/Jamf)
1. Configurar política de domínio
2. Usar formato JSON de configuração da extensão
3. Exemplo para Intune:
```json
{
  "ExtensionSettings": {
    "EXTENSION_ID": {
      "installation_mode": "force_installed",
      "update_url": "https://seu-servidor.com/updates.xml"
    }
  }
}
```

---

## 4️⃣ Distribuição Manual (Email/Drive)

Para equipes pequenas:

1. **Preparar arquivo**
   ```
   fedex-psdu-integrator-1.0.0.zip    → Arquivo principal
   LEIA-ME.txt                         → Instruções de instalação
   ```

2. **Instruções para usuários**
   ```
   1. Baixe o arquivo ZIP
   2. Descompacte em uma pasta conhecida
      Ex: C:\Extensions\fedex-integrator
   
   3. Abra Chrome e vá para: chrome://extensions/
   
   4. Ative "Modo de desenvolvedor" (canto superior direito)
   
   5. Clique em "Carregar extensão não empacotada"
   
   6. Selecione a pasta descompactada
   
   7. Pronto! A extensão está instalada
   ```

3. **Distribuição**
   - Google Drive compartilhado
   - Email com anexo
   - Servidor corporativo
   - OneDrive/SharePoint

---

## 5️⃣ Versionamento e Atualizações

### Quando Atualizar
- Novos recursos implementados
- Bugs corrigidos
- Mudanças no manifest (permissões, hosts, etc)

### Processo de Atualização
1. Modifique código em `extension/`
2. Atualize versão em AMBOS arquivos:
   ```json
   // extension/manifest.json
   "version": "1.0.1"
   
   // package.json
   "version": "1.0.1"
   ```

3. Reconstrua o pacote:
   ```bash
   npm run extension:build
   ```
   
   Gera: `dist/fedex-psdu-integrator-1.0.1.zip`

4. **Chrome Web Store**: Upload da nova versão
5. **Distribuição Manual**: Envie novo arquivo ZIP

### Histórico de Versões
```
v1.0.0  - Lançamento inicial
v1.0.1  - Ajustes de UX
v1.1.0  - Novos recursos implementados
...
```

---

## 6️⃣ Monitoramento Após Distribuição

### Metadados do Build
```json
{
  "name": "FedEx PSDU Integrator",
  "version": "1.0.0",
  "buildDate": "2026-03-27T09:33:13.000Z",
  "packageFile": "fedex-psdu-integrator-1.0.0.zip"
}
```

Arquivo em: `dist/fedex-psdu-integrator-1.0.0.json`

### Feedback de Usuários
- Chrome Web Store: Comentários e ratings
- Email: suporte@seu-dominio.com
- Issues: GitHub repository

### Estatísticas
- Chrome Web Store fornece:
  - Downloads totais
  - Usuários ativos
  - Ratings médios
  - Comentários registrados

---

## 7️⃣ Segurança e Conformidade

### Checklist de Segurança
- ✅ Manifest v3 (padrão moderno seguro)
- ✅ Sem dados sensíveis no código
- ✅ HTTPS obrigatório para APIs
- ✅ Chrome Storage API para persistência
- ✅ Permissões mínimas necessárias
- ✅ Sem rastreamento/analytics de terceiros

### Conformidade
- ✅ GDPR: Sem coleta de dados pessoais
- ✅ Privacy: Dados armazenados localmente
- ✅ ToS: Não viola políticas do Chrome Web Store

---

## 8️⃣ Troubleshooting na Distribuição

| Problema | Solução |
|----------|---------|
| Arquivo ZIP corrompido | Reconstrua com `npm run extension:build` |
| Versão não atualiza | Verifique sincronização em manifest.json e package.json |
| Permissões rejeitadas | Justifique uso de cada permissão |
| Imagens não aceitam | Use formatos PNG/JPEG, tamanhos exatos |
| Usuários relatam bugs | Corrija, atualize versão, faça novo build e resubmeta |

---

## 📞 Suporte

Para problemas com a extensão:

1. **Documentação**: Consulte [extension/README.md](./README.md)
2. **Desenvolvedor**: Abra DevTools (F12) na página
3. **Service Worker**: chrome://extensions/ → Detalhes → Erros
4. **Feedback**: Em desenvolvimento, carregue a pasta locally

---

## ✅ Checklist Final Antes de Distribuir

- [ ] Versão sincronizada (manifest.json = package.json)
- [ ] Build testado localmente em chrome://extensions/
- [ ] Sem erros no console (F12)
- [ ] Arquivo ZIP gerado em `dist/`
- [ ] README.md completo
- [ ] Imagens/ícones preparados (se usar Web Store)
- [ ] Descrição e changelog prontos
- [ ] Consentimento de usuário para permissões
- [ ] Backup do código fonte
- [ ] Plano de versionamento definido

---

**Documento revisado**: 27 de março de 2026  
**Versão da extensão**: 1.0.0  
**Status**: ✅ Pronta para distribuição
