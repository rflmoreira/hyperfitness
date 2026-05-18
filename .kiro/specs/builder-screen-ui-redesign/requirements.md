# Requirements Document

## Introduction

Este documento descreve os requisitos para a reformulação visual e de experiência da tela "Monte Seu Treino" (Builder Screen) do HyperFitness. A versão atual concentra muitas seções verticais visualmente pesadas (nome, semanas, agenda, resumo, abas de treino, slots, botão de adicionar) e abre o banco de exercícios em um modal sobreposto, fragmentando o fluxo do usuário.

A nova experiência adota um modelo inspirado no "Monte Seu PC" da KaBuM!: o usuário monta o programa em uma única tela, com o banco de exercícios integrado de forma inline (sem modais nem telas separadas). O foco é uma estética premium minimalista, hierarquia visual clara, espaçamento generoso, cards compactos e elegantes, feedback visual sofisticado ao interagir e fluidez na navegação, mantendo todas as funcionalidades existentes (semanas, agenda, treinos A/B/C, drag-and-drop, edição, exclusão, exercício personalizado, salvar/editar programas).

## Glossary

- **Builder Screen**: Tela principal de montagem de programa, identificada por `#builder-screen` no DOM.
- **Builder Header**: Barra superior fixa da Builder Screen contendo botão voltar, título e subtítulo.
- **Program Configuration Panel**: Área única e compacta que agrupa nome do programa, número de semanas e agenda semanal de treinos.
- **Workout Tabs Navigation**: Componente de abas A/B/C/... que permite alternar e gerenciar os treinos do programa.
- **Program Slots List**: Lista vertical dos exercícios já adicionados ao treino ativo, identificada por `#builder-slots-list`.
- **Exercise Slot Card**: Cartão compacto que representa um exercício adicionado, contendo thumbnail, nome, metadados (séries/reps/descanso/método) e ações (editar/excluir/reordenar).
- **Exercise Picker Panel**: Painel inline integrado à Builder Screen que substitui o antigo modal `#exercise-picker-modal`, permitindo busca, filtro e seleção de exercícios sem perder o contexto da tela.
- **Picker Search**: Campo de busca textual do Exercise Picker Panel.
- **Picker Filters**: Conjunto de chips de filtro por grupo muscular dentro do Exercise Picker Panel.
- **Picker Item**: Cartão individual de exercício dentro do Exercise Picker Panel.
- **Custom Exercise Action**: Ação dentro do Exercise Picker Panel que inicia o fluxo de criação de exercício personalizado.
- **Exercise Form**: Formulário de configuração do exercício adicionado (séries, repetições, descanso, método), atualmente implementado no modal `#exercise-edit-modal`.
- **Builder Footer**: Barra inferior fixa contendo o botão de salvar/criar treino.
- **Premium Visual Feedback**: Conjunto de microinterações (transições suaves, mudanças de estado, indicadores de seleção, ripple sutil) aplicadas a elementos interativos para reforçar a percepção de qualidade.
- **Active Workout**: Treino atualmente selecionado nas Workout Tabs Navigation, cujo conteúdo é exibido na Program Slots List.
- **Mobile Layout**: Renderização da Builder Screen em viewports com largura inferior a 768px.
- **Desktop Layout**: Renderização da Builder Screen em viewports com largura igual ou superior a 768px.

## Requirements

### Requirement 1: Estética premium minimalista e hierarquia visual

**User Story:** Como usuário do HyperFitness, quero uma Builder Screen com aparência limpa e premium, para que eu possa montar meus treinos sem sobrecarga visual e com foco no que importa.

#### Acceptance Criteria

1. THE Builder Screen SHALL apresentar no máximo três níveis de hierarquia tipográfica visíveis simultaneamente (título principal, rótulos de seção e conteúdo).
2. THE Builder Screen SHALL utilizar a paleta existente do projeto definida pelas variáveis CSS `--primary-color`, `--text`, `--subtext-1`, `--surface-0`, `--surface-1`, `--surface-2`, `--glass-border` e `--background-dark`, sem introduzir novas cores hardcoded fora dessas variáveis.
3. THE Builder Screen SHALL aplicar espaçamento vertical mínimo de 16px e máximo de 32px entre seções de nível superior.
4. THE Builder Screen SHALL exibir cada seção principal sem moldura de bloco fechado (sem caixas duplas), preferindo separadores sutis ou espaçamento ao invés de cards aninhados.
5. THE Program Configuration Panel SHALL agrupar nome do programa, seleção de semanas e agenda semanal em um único bloco visual contínuo, em vez de três blocos separados.
6. THE Builder Screen SHALL remover o bloco de estatísticas redundante `#builder-summary` na sua forma atual de três cards e SHALL apresentar contagens essenciais (exercícios e semanas) em formato textual inline ou no cabeçalho do treino ativo.
7. WHEN a seção do Program Configuration Panel está colapsada, THE Builder Screen SHALL exibir um resumo de uma linha contendo nome do programa, número de semanas e contagem de dias de treino.
8. THE Builder Screen SHALL utilizar bordas arredondadas com raio entre 12px e 20px em todos os componentes de superfície de primeiro nível, mantendo consistência visual.

### Requirement 2: Integração inline do banco de exercícios

**User Story:** Como usuário, quero adicionar exercícios ao meu treino sem que abra um modal sobreposto, para que eu mantenha o contexto da tela principal e tenha um fluxo similar ao "Monte Seu PC" da KaBuM!.

#### Acceptance Criteria

1. THE Builder Screen SHALL substituir o modal `#exercise-picker-modal` por um Exercise Picker Panel renderizado inline dentro da própria Builder Screen.
2. THE Exercise Picker Panel SHALL NOT utilizar `position: fixed` com sobreposição de tela cheia nem `backdrop-filter` global que oculte a Program Slots List.
3. WHEN o usuário aciona "Adicionar exercício", THE Builder Screen SHALL exibir o Exercise Picker Panel sem fechar, ocultar ou desmontar a Program Slots List.
4. WHILE o Exercise Picker Panel está visível, THE Builder Screen SHALL manter visíveis simultaneamente o Workout Tabs Navigation, a Program Slots List do Active Workout e o Builder Footer.
5. WHEN o usuário seleciona um Picker Item no Exercise Picker Panel, THE Builder Screen SHALL adicionar o exercício à Program Slots List do Active Workout sem fechar o Exercise Picker Panel.
6. WHEN o usuário aciona o controle "fechar" do Exercise Picker Panel, THE Builder Screen SHALL recolher o painel mantendo todas as adições já realizadas.
7. WHERE o Desktop Layout está ativo, THE Builder Screen SHALL exibir o Exercise Picker Panel lado a lado com a Program Slots List em layout de duas colunas.
8. WHERE o Mobile Layout está ativo, THE Builder Screen SHALL exibir o Exercise Picker Panel como uma seção empilhada acoplada à Program Slots List, sem cobri-la totalmente, permitindo rolagem entre as duas áreas.
9. THE Exercise Picker Panel SHALL preservar os controles existentes Picker Search, Picker Filters, Picker Item e Custom Exercise Action.
10. IF o usuário aciona Custom Exercise Action, THEN THE Builder Screen SHALL abrir o fluxo de criação de exercício personalizado existente preservando o estado atual do Exercise Picker Panel.

### Requirement 3: Cards de exercício compactos e elegantes

**User Story:** Como usuário, quero ver os exercícios adicionados em cards compactos e visualmente elegantes, para que eu consiga visualizar mais exercícios na tela sem rolar excessivamente.

#### Acceptance Criteria

1. THE Exercise Slot Card SHALL ter altura entre 64px e 88px no Mobile Layout e entre 72px e 96px no Desktop Layout.
2. THE Exercise Slot Card SHALL exibir thumbnail do exercício com tamanho entre 48x48px e 64x64px.
3. THE Exercise Slot Card SHALL exibir nome do exercício, séries, repetições, descanso e método em uma única linha de metadados quando o espaço horizontal for suficiente.
4. WHERE o Mobile Layout está ativo e o espaço horizontal não comporta todos os metadados em uma linha, THE Exercise Slot Card SHALL exibir séries e repetições na primeira linha e descanso e método na segunda linha, ou ocultar metadados secundários quando o espaço continuar insuficiente.
5. THE Exercise Slot Card SHALL apresentar ações de editar, excluir e reordenar de forma minimalista, com ícones sem rótulos textuais e tamanho de toque mínimo de 36x36px.
6. THE Exercise Slot Card SHALL utilizar uma única borda sutil (1px) e não SHALL utilizar sombras com offset superior a 8px em estado padrão.
7. THE Picker Item SHALL ter dimensões consistentes em formato quadrado com aspect-ratio 1:1 e largura mínima de 140px no Desktop Layout e 120px no Mobile Layout.
8. THE Picker Item SHALL exibir thumbnail, nome do exercício e indicador de grupo muscular sem informações adicionais visíveis no estado padrão.

### Requirement 4: Feedback visual premium em interações

**User Story:** Como usuário, quero ter feedback visual sofisticado ao selecionar e manipular exercícios, para que cada ação me transmita sensação de qualidade e responda imediatamente à minha intenção.

#### Acceptance Criteria

1. WHEN o usuário passa o cursor sobre um Picker Item no Desktop Layout, THE Exercise Picker Panel SHALL aplicar uma transição de elevação com duração entre 150ms e 250ms.
2. WHEN o usuário toca ou clica em um Picker Item, THE Exercise Picker Panel SHALL aplicar Premium Visual Feedback consistindo em destaque com cor primária, animação de seleção com duração entre 200ms e 400ms e atualização imediata do indicador de adição.
3. WHEN um exercício é adicionado à Program Slots List, THE Builder Screen SHALL animar a entrada do novo Exercise Slot Card com transição de opacidade e deslocamento vertical com duração entre 200ms e 350ms.
4. WHEN o usuário inicia o arrasto de um Exercise Slot Card, THE Builder Screen SHALL exibir indicador visual de arrasto com elevação e contorno na cor primária.
5. WHEN o usuário solta um Exercise Slot Card em nova posição, THE Builder Screen SHALL aplicar animação de acomodação com duração entre 150ms e 300ms.
6. WHILE um Picker Item está selecionado e ainda visível no Exercise Picker Panel após adição, THE Exercise Picker Panel SHALL exibir um indicador visual persistente de "já adicionado" no Picker Item correspondente, atualizado dinamicamente conforme a Program Slots List é alterada.
7. THE Builder Screen SHALL utilizar transições com função de tempo `ease-out` ou `cubic-bezier` equivalente em todas as microinterações de feedback de seleção e adição.
8. IF o sistema operacional do usuário tem `prefers-reduced-motion` habilitado, THEN THE Builder Screen SHALL reduzir as animações para transições de no máximo 80ms ou desativá-las.

### Requirement 5: Aproveitamento e organização do espaço da tela

**User Story:** Como usuário, quero que a Builder Screen aproveite melhor o espaço disponível, para que eu visualize mais conteúdo útil simultaneamente sem sensação de aperto ou de excesso de scroll.

#### Acceptance Criteria

1. WHERE o Desktop Layout está ativo com largura mínima de 1024px, THE Builder Screen SHALL utilizar largura máxima de conteúdo de pelo menos 1024px.
2. WHERE o Desktop Layout está ativo, THE Builder Screen SHALL apresentar o Program Configuration Panel em uma única linha horizontal contendo nome do programa, semanas e resumo da agenda, com a configuração detalhada da agenda acessível por expansão.
3. WHERE o Mobile Layout está ativo, THE Builder Screen SHALL preservar largura total disponível com padding lateral entre 12px e 20px.
4. THE Builder Screen SHALL manter o Builder Header e o Builder Footer fixos, SHALL apresentar o Exercise Picker Panel e a Program Slots List como áreas com rolagem independente quando ambos estiverem visíveis no Desktop Layout.
5. THE Builder Screen SHALL exibir no máximo um botão flutuante ou fixo de ação principal por vez, evitando competição com o Builder Footer.
6. WHEN a Program Slots List está vazia, THE Builder Screen SHALL exibir um estado vazio compacto com altura máxima absoluta de 240px contendo ícone, mensagem curta e instrução de adicionar exercício através do Exercise Picker Panel, truncando conteúdo quando necessário para respeitar o limite.
7. THE Builder Screen SHALL eliminar bordas duplas e empilhamento de superfícies translúcidas com mais de duas camadas de blur.

### Requirement 6: Navegação fluida e contínua

**User Story:** Como usuário, quero navegar entre os treinos A/B/C, semanas e exercícios sem interrupções, para que minha montagem do programa seja contínua.

#### Acceptance Criteria

1. WHEN o usuário aciona uma aba no Workout Tabs Navigation, THE Builder Screen SHALL atualizar o conteúdo da Program Slots List com transição suave de duração entre 150ms e 300ms, sem recarregar a tela.
2. WHEN o usuário altera o número de semanas, THE Builder Screen SHALL atualizar instantaneamente a contagem exibida no resumo do Program Configuration Panel sem causar reflow visível em outras seções.
3. WHEN o usuário altera a agenda semanal, THE Builder Screen SHALL atualizar instantaneamente o resumo da agenda sem fechar o Exercise Picker Panel se estiver aberto.
4. WHILE o Exercise Picker Panel está aberto e o usuário troca o Active Workout no Workout Tabs Navigation, THE Builder Screen SHALL preservar conjuntamente a busca e o filtro selecionado no Exercise Picker Panel.
5. WHEN o Exercise Picker Panel é fechado, THE Builder Screen SHALL resetar o Picker Search e os Picker Filters, de modo que a próxima reabertura inicie em estado limpo.
6. THE Workout Tabs Navigation SHALL permitir adicionar e remover treinos sem fechar o Exercise Picker Panel.
7. IF o usuário tenta remover o último treino do Workout Tabs Navigation, THEN THE Builder Screen SHALL bloquear a remoção e exibir notificação informando que ao menos um treino é obrigatório.

### Requirement 7: Responsividade em layouts mobile e desktop

**User Story:** Como usuário, quero que a nova Builder Screen funcione bem tanto no celular quanto no desktop, para que eu monte treinos em qualquer dispositivo com a mesma qualidade.

#### Acceptance Criteria

1. WHERE a largura da viewport é inferior a 768px, THE Builder Screen SHALL aplicar Mobile Layout.
2. WHERE a largura da viewport é igual ou superior a 768px, THE Builder Screen SHALL aplicar Desktop Layout.
3. WHERE o Mobile Layout está ativo, THE Builder Screen SHALL apresentar o Exercise Picker Panel em painel inferior empilhado, alcançável via rolagem natural ou botão de toggle, sem cobertura total da Program Slots List.
4. WHERE o Desktop Layout está ativo, THE Builder Screen SHALL apresentar a Program Slots List ocupando entre 50% e 60% da largura útil e o Exercise Picker Panel ocupando o restante.
5. THE Builder Screen SHALL garantir que todos os elementos interativos tenham área de toque mínima de 40x40px no Mobile Layout.
6. WHEN a orientação do dispositivo muda entre retrato e paisagem, THE Builder Screen SHALL recalcular o layout e preservar o estado atual do Active Workout, do Picker Search e dos Picker Filters.

### Requirement 8: Preservação de funcionalidades existentes

**User Story:** Como usuário existente do HyperFitness, quero que todas as funcionalidades atuais da Builder Screen continuem funcionando após o redesign, para que eu não perca nenhum recurso já incorporado ao meu fluxo.

#### Acceptance Criteria

1. THE Builder Screen SHALL preservar a entrada do nome do programa via campo de texto vinculado a `BUILDER_STATE.name`.
2. THE Builder Screen SHALL preservar a seleção de número de semanas com presets e entrada customizada vinculada a `BUILDER_STATE.totalWeeks`.
3. THE Builder Screen SHALL preservar a agenda semanal de 7 dias permitindo atribuir nenhum treino, treino A, B ou C ou treino adicional a cada dia, vinculada a `BUILDER_STATE.schedule`.
4. THE Workout Tabs Navigation SHALL preservar o suporte a múltiplos treinos identificados por letras A, B, C e seguintes, com renomeação inline do treino, vinculados a `BUILDER_STATE.workouts` e `BUILDER_STATE.activeWorkoutKey`.
5. THE Program Slots List SHALL preservar drag-and-drop para reordenação dos Exercise Slot Cards utilizando a integração existente com SortableJS armazenada em `BUILDER_STATE.sortable`.
6. THE Exercise Slot Card SHALL preservar as ações de editar e excluir, sendo que editar abre o Exercise Form com séries, repetições, descanso e método.
7. THE Custom Exercise Action SHALL preservar o fluxo existente de criação de exercício personalizado.
8. THE Builder Footer SHALL preservar o botão de salvar com rótulo "Criar treino" no modo criar e "Salvar alterações" no modo editar, refletindo `BUILDER_STATE.mode`.
9. WHEN o usuário aciona o botão de salvar, THE Builder Screen SHALL persistir o programa utilizando o mecanismo existente de armazenamento associado a `BUILDER_STATE.programId`.
10. WHEN a Builder Screen é aberta em modo editar com um `BUILDER_STATE.programId` válido, THE Builder Screen SHALL carregar todos os dados do programa existente e renderizar o Active Workout, Workout Tabs Navigation, Program Configuration Panel e Program Slots List conforme o estado salvo.
11. IF o usuário tenta salvar com nome do programa vazio ou sem ao menos um exercício em qualquer treino, THEN THE Builder Screen SHALL bloquear a ação e exibir mensagem orientativa, mantendo o comportamento atual do botão salvar desabilitado.

### Requirement 9: Acessibilidade e semântica

**User Story:** Como usuário com necessidades de acessibilidade, quero que a nova Builder Screen seja navegável por teclado e leitores de tela, para que eu consiga usar o app sem barreiras.

#### Acceptance Criteria

1. THE Exercise Picker Panel SHALL expor `role="region"` e `aria-label` descritivo identificando-o como banco de exercícios.
2. THE Exercise Slot Card SHALL expor `role="listitem"` dentro de uma Program Slots List com `role="list"`.
3. THE Workout Tabs Navigation SHALL implementar navegação por teclado utilizando setas esquerda e direita para alternar abas.
4. WHEN um Picker Item recebe foco via teclado, THE Exercise Picker Panel SHALL exibir indicador de foco visível com contraste mínimo de 3:1 contra o fundo.
5. WHEN o usuário pressiona Enter ou Espaço com um Picker Item focado, THE Exercise Picker Panel SHALL adicionar o exercício correspondente à Program Slots List do Active Workout.
6. THE Builder Screen SHALL preservar `aria-live` apropriado para notificações de adição, edição e exclusão de exercícios.
7. THE Builder Screen SHALL preservar contraste mínimo de 4.5:1 entre texto principal e fundo em todos os componentes redesenhados.
