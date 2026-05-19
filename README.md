# TechHacker - Privacy Guardian

Uma extensão Firefox para detectar ameaças à privacidade e rastreamento em páginas web.

---

## Características

- Detecção de Domínios de Terceira Parte - Identifica rastreadores externos
- Análise de Cookies - Classifica cookies por origem e tipo
- Monitoramento de Storage - Detecta localStorage, sessionStorage e IndexedDB
- Fingerprinting Detection - Monitora Canvas, WebGL e AudioContext
- Hijacking Detection - Alerta sobre tentativas de sequestro do navegador
- Privacy Score - Pontuação de privacidade de 0-100

---

## Instalação e Uso

### Pré-requisitos
- Firefox (versão 120+)
- Esta extensão

### Instalação em Modo de Desenvolvimento

1. Clonar ou baixar o repositório
   ```bash
   git clone <url-do-repositorio>
   cd techacker-roteiro-4
   ```

2. Abrir Firefox e acessar about:debugging
   - Digite `about:debugging` na barra de endereços
   - Clique em "Este Firefox"

3. Carregar a extensão
   - Clique em "Carregar extensão temporária"
   - Navegue até a pasta `techacker-roteiro-4`
   - Selecione o arquivo `manifest.json`

4. Usar a extensão
   - A extensão aparecerá na barra de ferramentas do Firefox
   - Clique no ícone para abrir o popup
   - Navegue para qualquer site e veja os dados coletados

---

## Estrutura do Projeto

```
techacker-roteiro-4/
├── manifest.json              # Configuração principal da extensão
├── src/
│   ├── background.js          # Coleta e mantém pageData[tabId]
│   ├── content.js             # Ponte: injeta injected.js e repassa postMessage
│   ├── injected.js            # Roda no MAIN world: hooks de fingerprinting/rede
│   ├── popup.html             # Interface do popup
│   ├── popup.js               # Lógica do popup
│   └── popup.css              # Estilos do popup
├── icons/                     # Ícones da extensão
├── .gitignore                 # Arquivos ignorados no Git
└── README.md                  # Este arquivo
```

---

## Desenvolvimento

### Estrutura de Funcionamento

1. manifest.json: Define permissões, scripts e configuração
2. content.js: Injetado em TODAS as páginas (isolated world); injeta injected.js no MAIN world e repassa eventos via postMessage
3. injected.js: Roda no mesmo contexto JS da página; sobrescreve protótipos para detectar fingerprinting e requisições
4. background.js: Coleta dados do content.js via mensagens e mantém pageData[tabId]
5. popup.js: Solicita dados ao background passando o tabId da aba ativa

### Debugging

Para ver mensagens de debug:
1. Abra `about:debugging`
2. Clique em "Inspecionar" da extensão
3. Abra a aba "Console"

---

## Detecção de Fingerprinting

Browser fingerprinting é a técnica de extrair características do navegador (GPU, fontes, áudio, canvas) para gerar um identificador único, mesmo sem cookies. A extensão monitora as três APIs mais usadas para fingerprinting moderno:

### APIs monitoradas

| API | Métodos hookados | O que detecta |
|---|---|---|
| Canvas | `HTMLCanvasElement.toDataURL`, `CanvasRenderingContext2D.getImageData` | Canvas fingerprinting — renderização de texto/formas para extrair diferenças de GPU e antialiasing |
| WebGL | `WebGLRenderingContext.getParameter` e `WebGL2RenderingContext.getParameter` (com pname `UNMASKED_RENDERER_WEBGL` / `UNMASKED_VENDOR_WEBGL`) | Identificação de GPU e driver |
| AudioContext | `createOscillator`, `createDynamicsCompressor` (online e offline) | AudioContext fingerprinting — processa um sinal de áudio para extrair diferenças de hardware/SO |

### Por que isso precisa rodar no MAIN world

Content scripts rodam num *isolated world*: compartilham o DOM com a página, mas têm um JavaScript context separado. Sobrescrever `HTMLCanvasElement.prototype.toDataURL` no content script não afeta o protótipo que a página enxerga.

A extensão resolve isso com dois arquivos:

1. `src/injected.js` — declarado em `web_accessible_resources` no manifest. Contém todos os hooks de protótipo.
2. `src/content.js` — roda em `document_start`, cria um `<script src=...>` apontando para `injected.js` e adiciona ao `document.documentElement` antes do head ser parseado. Resultado: o script da extensão executa no mesmo contexto JS da página antes de qualquer script do site rodar.

A comunicação `injected.js` → `content.js` é feita via `window.postMessage` com a tag `TECHACKER_EVENT`. O content.js valida `event.source === window` e a tag antes de repassar ao background.

### Como testar

| Site | O que esperar |
|---|---|
| https://coveryourtracks.eff.org | Clicar em "Test Your Browser" gera várias entradas de Canvas e WebGL |
| https://amiunique.org | A página de teste gera fingerprints de Canvas, WebGL e Audio |
| https://fingerprintable.org | Site de demonstração de várias técnicas, útil para confirmar Audio fingerprinting |

Reload da página é necessário depois de qualquer reload da extensão — os hooks só são instalados no carregamento.

---

## Rastreamento de Rede, Supercookies e Cookie Syncing

A coleta de requisições de rede é feita pelo background usando a API `webRequest` do Firefox — não via hooks de `fetch`/`XHR` no page world. O motivo: `webRequest` vê **todas** as requisições do navegador (incluindo imagens, fontes, iframes, websockets), expõe o tipo de recurso (`script`, `image`, `xmlhttprequest`, `font`, etc.) e funciona mesmo em páginas que reescrevem `fetch`/`XHR`.

> O Firefox manteve `webRequest` no Manifest V3. O Chrome migrou para `declarativeNetRequest` em 2025, perdendo essa capacidade — o que aliás é uma das razões pelas quais o roteiro foca em Firefox.

### Domínios 3ª parte com tipo de recurso

A aba **Rastreamento** agrupa por domínio e mostra badges com os tipos de recurso (`script`, `imagem`, `iframe`, `xhr`, `font`, `media`, ...) que esse domínio serviu.

### Candidatos a Supercookie

Supercookies sobrevivem à limpeza de cookies. A extensão monitora cabeçalhos de resposta via `webRequest.onHeadersReceived` para duas heurísticas:

| Tipo | Sinal | Onde |
|---|---|---|
| **ETag** | Header `ETag` em respostas de 3ª parte com tipo `image`, `ping` ou `xmlhttprequest` (pixels de tracking podem usar ETag como ID persistente). ETags que parecem hash de conteúdo (32/40/64 hex — MD5/SHA1/SHA256, padrão de cache em CDN) são descartados | Aba Cookies → "Candidatos a Supercookie" |
| **HSTS** | Header `Strict-Transport-Security` com `max-age` > 1 ano em resposta de 3ª parte (potencial canal de fingerprint persistente via cache HSTS) | Aba Cookies → "Candidatos a Supercookie" |

São **candidatos**, não detecções definitivas. ETag também é usado legitimamente para cache. A interpretação fica a cargo do usuário.

### Cookie Syncing

Detectado em `webRequest.onBeforeRequest` analisando query strings de requisições 3ª parte:

1. Para cada requisição 3ª parte, extrai params cujo nome bate em `^(uid|user_id|userid|user|id|gid|cid|did|sid|fid|cookie_?id|partner_?id|sync|guid|adid|uuid|tuuid|tu_id|tdid|euid|ext_id)$` (lista derivada de padrões usados por DSPs/SSPs comuns).
2. Filtra valores com formato de ID (alfanumérico, 10-200 chars).
3. Mantém um mapa `valor → Set<domínio>` por aba.
4. Quando o mesmo valor aparece em ≥2 domínios diferentes, registra um evento de syncing.

Limitações: a heurística pega apenas IDs passados via query string (a forma mais comum), não via POST body nem fragmentos. Falsos negativos esperados para trackers que ofuscam o ID via hashing.

---

## Privacy Score - Metodologia

A pontuação começa em 100 e sofre penalidades capadas para cada vetor. Todos os tetos garantem que nenhum vetor isolado zere o score sozinho, e a soma máxima possível de penalidades é -105 (i.e. piora pode ser severa, mas refletida em camadas).

| Vetor | Penalidade unitária | Teto |
|---|---|---|
| Domínio de 3ª parte | -2 | -30 |
| Tentativa de fingerprinting (Canvas/WebGL/Audio) | -5 | -30 |
| Ameaça de hijacking | -10 | -25 |
| Cookie (1ª + 3ª parte) | -1 | -20 |

### Por que os tetos

Sem tetos, sites com muitos componentes (CMS, ad networks, frameworks) zerariam o score mesmo quando o comportamento é típico. Os tetos limitam o impacto de cada categoria a uma faixa que ainda comunica gravidade — uma página com 100+ trackers e fingerprinting agressivo ainda fica em "Crítico", mas o score permanece interpretável.

### Critério de hijacking

A versão atual sinaliza apenas:
- `location.assign` / `location.replace` cross-domain
- `eval()` com payload de ≥50 caracteres (descarta polyfills/feature detection curtos)

O construtor `Function()` foi intencionalmente excluído da detecção: bibliotecas como jQuery, Vue, React e GTM o usam para compilar templates, o que gera falso positivo em quase todo site real.

### Interpretação

- 80-100: Excelente
- 60-79: Bom
- 40-59: Razoável
- 20-39: Ruim
- 0-19: Crítico

---

## Limitações Conhecidas

- Algumas técnicas sofisticadas de fingerprinting podem não ser detectadas
- A detecção depende de quando a página injeta os scripts
- Alguns redirecionamentos podem não ser capturados
