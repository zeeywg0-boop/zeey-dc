// SlChatTools — plugin para ShiggyCord
// Comandos:
//   /slt            → esconde botões de presente, emoji e áudio (fica só o enviar)
//   /sltoff         → desfaz a modificação do /slt
//   /soletrar       → mesmo efeito do /slt + "oi bom dia" vira OI\nBOM\nDIA
//   /soletraroff    → desliga o modo soletrar
//   /auto [texto]   → fica enviando o texto até usar /autooff
//   /autooff        → para o /auto
(() => {
  const { find, findByName, findByProps, findByStoreName } = vendetta.metro;
  const { React, FluxDispatcher } = vendetta.metro.common;
  const Patcher = vendetta.patcher;
  const { registerCommand } = vendetta.commands;
  const { showToast } = vendetta.ui.toasts;
  const storage = vendetta.plugin.storage;

  if (storage.slt == null) storage.slt = false;
  if (storage.soletrar == null) storage.soletrar = false;

  let autoText = null;
  let autoTimer = null;
  const unpatches = [];

  // ---------- Referências do Discord ----------
  const MessageActions = findByProps("sendMessage", "editMessage");
  const SelectedChannelStore = findByStoreName("SelectedChannelStore");

  // ---------- Estado ----------
  const hideButtons = () => storage.slt || storage.soletrar;

  // ---------- Esconder botões ----------
  // Ajuste a regex se algum botão não sumir na sua versão do Discord
  const HIDE_RE = /gift|presente|emoji|sticker|figurinha|microphone|microfone|voice message|mensagem de voz|attach|anexo/i;

  function filterEl(el) {
    try {
      if (!el || typeof el !== "object" || !el.props) return el;
      const p = el.props || {};
      const label = `${p.accessibilityLabel ?? ""} ${p.testID ?? ""} ${el.type?.name ?? ""} ${el.type?.displayName ?? ""}`;
      if (hideButtons() && HIDE_RE.test(label)) return null;

      if (p.children == null) return el;
      const newKids = React.Children.toArray(p.children).map(filterEl);
      return React.cloneElement(el, undefined, ...newKids);
    } catch (e) {
      return el;
    }
  }

  // Procura o componente da barra de input por vários nomes possíveis
  function patchInputBar() {
    const names = ["ChatInput", "ChannelTextArea", "ChatInputBar", "InputBar", "ChannelTextAreaBar", "TextArea"];
    let patched = 0;
    for (const name of names) {
      const mod = findByName(name);
      if (mod && (mod.default || typeof mod === "function")) {
        try {
          unpatches.push(Patcher.after("default", mod, (_, ret) => filterEl(ret)));
          patched++;
        } catch (e) {}
      }
    }
    if (!patched) {
      vendetta.logger.warn("SlChatTools: não achei o componente da barra de chat. Nomes testados: " + names.join(", "));
    }
  }

  function forceRerender() {
    try { SelectedChannelStore?.emitChange?.(); } catch {}
  }

  // ---------- Soletrar ----------
  function soletrarify(text) {
    return String(text)
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.toUpperCase())
      .join("\n");
  }

  function patchSend() {
    if (!MessageActions?.sendMessage) return;
    unpatches.push(
      Patcher.instead("sendMessage", MessageActions, (args, orig) => {
        let newArgs = args;
        if (storage.soletrar) {
          if (typeof args[1] === "string" && args[1].trim()) {
            newArgs = [...args];
            newArgs[1] = soletrarify(args[1]);
          } else if (args[1] && typeof args[1] === "object" && typeof args[1].content === "string" && args[1].content.trim()) {
            newArgs = [...args];
            newArgs[1] = { ...args[1], content: soletrarify(args[1].content) };
          }
        }
        return orig(...newArgs);
      })
    );
  }

  // ---------- Auto ----------
  function stopAuto(silent) {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
    autoText = null;
    if (!silent) showToast("Auto desligado");
  }

  function startAuto(text) {
    stopAuto(true);
    autoText = text;
    // intervalo de 2s — cuidado com slowmode/spam
    autoTimer = setInterval(() => {
      try {
        const channelId = SelectedChannelStore?.getChannelId?.();
        if (!channelId || !autoText) return;
        MessageActions.sendMessage(channelId, { content: autoText });
      } catch (e) {
        vendetta.logger.error("SlChatTools auto:", e);
      }
    }, 2000);
    showToast("Auto ligado: " + text);
  }

  // ---------- Comandos ----------
  const cmd = (name, description, options, execute) =>
    registerCommand({
      name,
      displayName: name,
      description,
      displayDescription: description,
      options: options || [],
      applicationId: "-1",
      inputType: 1,
      type: 1,
      execute,
    });

  const textoOption = {
    name: "texto",
    displayName: "texto",
    description: "Texto para enviar repetidamente",
    displayDescription: "Texto para enviar repetidamente",
    type: 3,
    required: true,
  };

  function getOptValue(args) {
    if (!args) return null;
    if (Array.isArray(args)) return args.find((o) => o?.name === "texto")?.value ?? null;
    return args.texto ?? null;
  }

  return {
    onLoad() {
      patchInputBar();
      patchSend();

      unpatches.push(
        cmd("slt", "Esconde os botões de presente, emoji e áudio (fica só o de enviar)", [], () => {
          storage.slt = true;
          forceRerender();
          showToast("Modo slt ativado");
        }),
        cmd("sltoff", "Desativa o modo slt", [], () => {
          storage.slt = false;
          forceRerender();
          showToast("Modo slt desativado");
        }),
        cmd("soletrar", "Igual ao slt, mas frases viram palavras em maiúsculas, uma por linha", [], () => {
          storage.soletrar = true;
          forceRerender();
          showToast("Modo soletrar ativado");
        }),
        cmd("soletraroff", "Desativa o modo soletrar", [], () => {
          storage.soletrar = false;
          forceRerender();
          showToast("Modo soletrar desativado");
        }),
        cmd("auto", "Fica enviando o texto até usar /autooff", [textoOption], (args) => {
          const texto = getOptValue(args);
          if (!texto) return void showToast("Use /auto texto");
          startAuto(texto);
        }),
        cmd("autooff", "Para o /auto", [], () => {
          if (autoTimer) stopAuto();
          else showToast("Auto não estava ligado");
        })
      );
    },

    onUnload() {
      stopAuto(true);
      for (const u of unpatches.splice(0)) {
        try { u(); } catch {}
      }
    },
  };
})();
