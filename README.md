# TechHacker - Privacy Guardian

Uma extensão Firefox para detectar ameaças à privacidade e rastreamento em páginas web.

Trabalho de conclusão: Roteiro 4 - Prof. João Eduardo - Insper

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
│   ├── background.js          # Script de fundo (serviço worker)
│   ├── content.js             # Script injetado em todas as páginas
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
2. content.js: Injetado em TODAS as páginas, monitora atividades
3. background.js: Coleta dados do content.js via mensagens
4. popup.js: Solicita dados ao background quando aberto

### Debugging

Para ver mensagens de debug:
1. Abra `about:debugging`
2. Clique em "Inspecionar" da extensão
3. Abra a aba "Console"

---

## Privacy Score - Metodologia

O Privacy Score é calculado com base em:

- Começar com 100 pontos
- Penalidades:
  - Cada domínio de rastreamento: -2 pontos (máx -30)
  - Cada tentativa de fingerprinting: -5 pontos
  - Cada ameaça de hijacking: -10 pontos
  - Cada cookie: -1 ponto (máx -20)

Interpretação:
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
