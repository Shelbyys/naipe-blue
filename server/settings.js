'use strict';

const fs = require('node:fs');
const path = require('node:path');

/* Configurações ajustáveis pelo /admin, persistidas num JSON simples
   (mesmo volume dos pedidos). O que estiver aqui tem prioridade sobre
   as env vars — pensado pra quem prefere configurar pela interface em
   vez de editar variável de ambiente no EasyPanel a cada mudança. */
class Settings {
  constructor(file) {
    this.file = file || path.join(__dirname, 'data', 'settings.json');
    this.data = {};
    this._load();
  }

  _load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[settings] falha ao salvar:', err.message);
    }
  }

  get(key, fallback) {
    const v = this.data[key];
    return v !== undefined && v !== '' ? v : fallback;
  }

  setMany(patch) {
    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') delete this.data[k];
      else this.data[k] = v;
    });
    this._save();
  }

  clear() {
    this.data = {};
    this._save();
  }
}

module.exports = { Settings };
