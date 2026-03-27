#!/usr/bin/env node

/**
 * Script de Build para Empacotamento da Extensão Chrome
 * Gera arquivo ZIP pronto para distribuição
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const EXTENSION_DIR = path.join(__dirname, '..', 'extension');
const BUILD_DIR = path.join(__dirname, '..', 'dist');
const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');
const MANIFEST_JSON = path.join(EXTENSION_DIR, 'manifest.json');

// Validação de pré-requisitos
function validatePrerequisites() {
  console.log('📋 Validando pré-requisitos...\n');

  // Verificar se a pasta extension existe
  if (!fs.existsSync(EXTENSION_DIR)) {
    console.error('❌ Pasta extension/ não encontrada');
    process.exit(1);
  }

  // Incluir no arquivo ZIP
  const requiredFiles = [
    'manifest.json',
    'background.js',
    'content.js',
    'injected.js',
    'options.html',
    'options.js'
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(EXTENSION_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Arquivo obrigatório não encontrado: ${file}`);
      process.exit(1);
    }
    console.log(`✅ ${file}`);
  }

  console.log('\n✅ Todos os arquivos obrigatórios encontrados\n');
}

// Obter versão do package.json
function getVersion() {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  return packageJson.version;
}

// Validar manifest.json
function validateManifest() {
  console.log('🔍 Validando manifest.json...\n');

  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_JSON, 'utf8'));

    // Verificações básicas
    const required = ['manifest_version', 'name', 'version', 'description'];
    for (const field of required) {
      if (!manifest[field]) {
        console.error(`❌ Campo obrigatório faltando: ${field}`);
        process.exit(1);
      }
      console.log(`✅ ${field}: ${manifest[field]}`);
    }

    // Verificar permissions
    if (!manifest.permissions || manifest.permissions.length === 0) {
      console.warn('⚠️  Nenhuma permissão definida no manifest.json');
    } else {
      console.log(`✅ Permissões definidas: ${manifest.permissions.length}`);
    }

    console.log('\n✅ Manifest.json válido\n');
    return manifest.version;
  } catch (error) {
    console.error('❌ Erro ao validar manifest.json:', error.message);
    process.exit(1);
  }
}

// Criar diretório dist se não existir
function setupBuildDir() {
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }
}

// Empacotar extensão em ZIP
function createZipPackage(version) {
  return new Promise((resolve, reject) => {
    setupBuildDir();

    const zipFileName = `fedex-psdu-integrator-${version}.zip`;
    const output = fs.createWriteStream(path.join(BUILD_DIR, zipFileName));
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`\n✅ Arquivo criado com sucesso: ${zipFileName}`);
      console.log(`📦 Tamanho: ${(archive.pointer() / 1024).toFixed(2)} KB`);
      resolve(zipFileName);
    });

    archive.on('error', (error) => {
      console.error('❌ Erro ao criar arquivo ZIP:', error.message);
      reject(error);
    });

    archive.pipe(output);

    // Adicionar arquivos da extensão (incluindo pasta images)
    archive.directory(EXTENSION_DIR, 'extension');

    // Adicionar README
    const readmePath = path.join(EXTENSION_DIR, 'README.md');
    if (fs.existsSync(readmePath)) {
      archive.file(readmePath, { name: 'README.md' });
    }

    // Adicionar LICENSE se existir
    const licensePath = path.join(__dirname, '..', 'LICENSE');
    if (fs.existsSync(licensePath)) {
      archive.file(licensePath, { name: 'LICENSE' });
    }

    archive.finalize();
  });
}

// Criar arquivo de metadados
function createMetadata(version, zipFileName) {
  const metadata = {
    name: 'FedEx PSDU Integrator',
    version,
    description: 'Shopify to FedEx integration with PSDU support',
    packageFile: zipFileName,
    buildDate: new Date().toISOString(),
    buildPlatform: process.platform,
    nodeVersion: process.version
  };

  const metadataPath = path.join(BUILD_DIR, `${zipFileName.replace('.zip', '')}.json`);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  return metadataPath;
}

// Exibir resumo do build
function printSummary(version, zipFileName) {
  console.log('\n' + '='.repeat(50));
  console.log('📦 RESUMO DO BUILD');
  console.log('='.repeat(50));
  console.log(`\n  Extensão: FedEx PSDU Integrator`);
  console.log(`  Versão: ${version}`);
  console.log(`  Arquivo: ${zipFileName}`);
  console.log(`  Localização: ${path.join(BUILD_DIR, zipFileName)}`);
  console.log(`  Data: ${new Date().toLocaleString('pt-BR')}`);
  console.log('\n' + '='.repeat(50));
  console.log('\n🚀 Próximos passos:\n');
  console.log('  1. Teste a extensão em desenvolvimento:');
  console.log('     - chrome://extensions/');
  console.log('     - Ative "Modo de desenvolvedor"');
  console.log('     - Selecione a pasta extension/\n');
  console.log('  2. Submeta ao Chrome Web Store:');
  console.log('     - https://chrome.google.com/webstore/devconsole\n');
  console.log('  3. Ou distribua para instalação corporativa\n');
}

// Executar build
async function build() {
  console.log('\n🔨 Iniciando build da extensão...\n');

  try {
    validatePrerequisites();
    const manifestVersion = validateManifest();
    const packageVersion = getVersion();

    // Avisar se versões diferem
    if (manifestVersion !== packageVersion) {
      console.warn(`⚠️  Versão do manifest (${manifestVersion}) difere do package.json (${packageVersion})`);
      console.warn('   Atualize ambos os arquivos para evitar confusão\n');
    }

    const version = packageVersion;
    console.log(`📦 Empacotando versão ${version}...\n`);

    const zipFileName = await createZipPackage(version);
    const metadataPath = createMetadata(version, zipFileName);

    console.log(`📄 Metadados criados: ${path.basename(metadataPath)}`);

    printSummary(version, zipFileName);

    console.log('✅ Build concluído com sucesso!\n');
  } catch (error) {
    console.error('\n❌ Erro durante o build:', error.message);
    process.exit(1);
  }
}

// Executar
build();
