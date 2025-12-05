import {
    saveSettingsDebounced,
    substituteParams,
} from '../../../../script.js';
import { debounce } from '../../../utils.js';
import { promptQuietForLoudResponse, sendMessageAs, sendNarratorMessage } from '../../../slash-commands.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { registerSlashCommand } from '../../../slash-commands.js';

// NOTE: updated to Idle-Selfie
const extensionName = 'third-party/Idle-Selfie';

let idleTimer = null;
let repeatCount = 0;
let mostRecentIdleCaption = null;      // NEW
let waitingForIdleMessage = false;     // NEW

let defaultSettings = {
    enabled: false,
    timer: 120,
    prompts: [
        '*stands silently, looking deep in thought*',
        '*pauses, eyes wandering over the surroundings*',
        '*hesitates, appearing lost for a moment*',
        '*takes a deep breath, collecting their thoughts*',
        '*gazes into the distance, seemingly distracted*',
        '*remains still, absorbing the ambiance*',
        '*lingers in silence, a contemplative look on their face*',
        '*stops, fingers brushing against an old memory*',
        '*seems to drift into a momentary daydream*',
        '*waits quietly, allowing the weight of the moment to settle*',
    ],
    useContinuation: true,
    useRegenerate: false,
    useImpersonation: false,
    useSwipe: false,
    repeats: 2,
    sendAs: 'user',
    randomTime: false,
    timerMin: 60,
    includePrompt: false,

    // NEW SETTINGS
    geminiApiKey: '',
    geminiModel: 'gemini-1.5-flash',
    selfieEnabled: true,
};

//––––––––––––––––––––––––––––––––––––––––––––
// SETTINGS LOADING
//––––––––––––––––––––––––––––––––––––––––––––

async function loadSettings() {
    if (!extension_settings.idle) {
        extension_settings.idle = {};
    }
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!extension_settings.idle.hasOwnProperty(key)) {
            extension_settings.idle[key] = value;
        }
    }
    populateUIWithSettings();
}

function populateUIWithSettings() {
    $('#idle_timer').val(extension_settings.idle.timer).trigger('input');
    $('#idle_prompts').val(extension_settings.idle.prompts.join('\n')).trigger('input');
    $('#idle_use_continuation').prop('checked', extension_settings.idle.useContinuation).trigger('input');
    $('#idle_use_regenerate').prop('checked', extension_settings.idle.useRegenerate).trigger('input');
    $('#idle_use_impersonation').prop('checked', extension_settings.idle.useImpersonation).trigger('input');
    $('#idle_use_swipe').prop('checked', extension_settings.idle.useSwipe).trigger('input');
    $('#idle_enabled').prop('checked', extension_settings.idle.enabled).trigger('input');
    $('#idle_repeats').val(extension_settings.idle.repeats).trigger('input');
    $('#idle_sendAs').val(extension_settings.idle.sendAs).trigger('input');
    $('#idle_random_time').prop('checked', extension_settings.idle.randomTime).trigger('input');
    $('#idle_timer_min').val(extension_settings.idle.timerMin).trigger('input');
    $('#idle_include_prompt').prop('checked', extension_settings.idle.includePrompt).trigger('input');

    // NEW UI BINDINGS
    $('#idle_gemini_api').val(extension_settings.idle.geminiApiKey).trigger('input');
    $('#idle_gemini_model').val(extension_settings.idle.geminiModel).trigger('input');
    $('#idle_selfie_enabled').prop('checked', extension_settings.idle.selfieEnabled).trigger('input');
}

//––––––––––––––––––––––––––––––––––––––––––––
// IDLE TIMER
//––––––––––––––––––––––––––––––––––––––––––––

function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    let context = getContext();
    if (!context.characterId && !context.groupID) return;
    if (!extension_settings.idle.enabled) return;

    if (extension_settings.idle.randomTime) {
        let min = parseInt(extension_settings.idle.timerMin);
        let max = parseInt(extension_settings.idle.timer);
        let randomTime = (Math.random() * (max - min + 1)) + min;
        idleTimer = setTimeout(sendIdlePrompt, 1000 * randomTime);
    } else {
        idleTimer = setTimeout(sendIdlePrompt, 1000 * extension_settings.idle.timer);
    }
}

//––––––––––––––––––––––––––––––––––––––––––––
// BUILD SELFIE SYSTEM PROMPT
//––––––––––––––––––––––––––––––––––––––––––––

function buildSelfieSystemPrompt(basePrompt) {
    const context = getContext();
    const charName = context?.name2 ?? 'the character';

    return `
You are roleplaying as ${charName} in the current scene.

The user has been idle for a while.
Your next message should be a short, first-person, in-world "selfie" style message.

Strict rules:
- Write from ${charName}'s first-person perspective.
- ONE paragraph only.
- 1–3 sentences, max 60 words.
- Describe a selfie moment or just-after-selfie moment.
- Include pose, facial expression, outfit, setting, and overall vibe.
- Stay fully in character.
- Do NOT mention cameras, prompts, or AI.
${basePrompt ? `- Use this extra flavor: ${basePrompt}` : ''}
`.trim();
}

//––––––––––––––––––––––––––––––––––––––––––––
// IDLE PROMPT SENDER
//––––––––––––––––––––––––––––––––––––––––––––

async function sendIdlePrompt() {
    if (!extension_settings.idle.enabled) return;

    if (repeatCount >= extension_settings.idle.repeats || $('#mes_stop').is(':visible')) {
        resetIdleTimer();
        return;
    }

    const basePrompt = extension_settings.idle.prompts[
        Math.floor(Math.random() * extension_settings.idle.prompts.length)
    ];

    const selfieSystem = buildSelfieSystemPrompt(basePrompt);

    waitingForIdleMessage = true;
    mostRecentIdleCaption = null;

    sendPrompt(selfieSystem);

    repeatCount++;
    resetIdleTimer();
}

//––––––––––––––––––––––––––––––––––––––––––––
// SEND LOUD MESSAGE
//––––––––––––––––––––––––––––––––––––––––––––

function sendLoud(sendAs, prompt) {
    if (sendAs === 'user') {
        prompt = substituteParams(prompt);
        $('#send_textarea').val(prompt);
        $('#send_textarea').focus();
        $('#send_but').trigger('click');
    } else if (sendAs === 'char') {
        sendMessageAs('', `${getContext().name2}\n${prompt}`);
        promptQuietForLoudResponse(sendAs, '');
    } else if (sendAs === 'sys') {
        sendNarratorMessage('', prompt);
        promptQuietForLoudResponse(sendAs, '');
    }
}

//––––––––––––––––––––––––––––––––––––––––––––
// SEND PROMPT
//––––––––––––––––––––––––––––––––––––––––––––

function sendPrompt(prompt) {
    clearTimeout(idleTimer);
    $('#send_textarea').off('input');

    if (extension_settings.idle.useRegenerate) {
        $('#option_regenerate').trigger('click');
    } else if (extension_settings.idle.useContinuation) {
        $('#option_continue').trigger('click');
    } else if (extension_settings.idle.useImpersonation) {
        $('#option_impersonate').trigger('click');
    } else if (extension_settings.idle.useSwipe) {
        $('.last_mes .swipe_right').click();
    } else {
        if (extension_settings.idle.includePrompt) {
            sendLoud(extension_settings.idle.sendAs, prompt);
        } else {
            promptQuietForLoudResponse(extension_settings.idle.sendAs, prompt);
        }
    }
}

//––––––––––––––––––––––––––––––––––––––––––––
// GEMINI IMAGE GENERATOR
//––––––––––––––––––––––––––––––––––––––––––––

async function generateGeminiImage(caption) {
    const apiKey = extension_settings.idle.geminiApiKey;
    const model = extension_settings.idle.geminiModel;
    if (!apiKey) return null;

    const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
        contents: [
            { role: "user", parts: [{ text: caption }] }
        ],
        generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 2048
        }
    };

    const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!res.ok) return null;

    const data = await res.json();

    const imgPart = data?.candidates?.[0]?.content?.parts?.find(p => p.inline_data?.data);
    if (!imgPart) return null;

    const base64 = imgPart.inline_data.data;
    const mime = imgPart.inline_data.mime_type || 'image/png';

    const blob = await (await fetch(`data:${mime};base64,${base64}`)).blob();
    return blob;
}

//––––––––––––––––––––––––––––––––––––––––––––
// OBSERVE LAST MESSAGE (OPTION Y2 REPLACE MODE)
//––––––––––––––––––––––––––––––––––––––––––––

const observer = new MutationObserver(async () => {
    if (!waitingForIdleMessage) return;

    const last = document.querySelector('.mes:last-child');
    if (!last) return;

    const nameEl = last.querySelector('.mes_block .ch_name');
    const textEl = last.querySelector('.mes_text');

    if (!nameEl || !textEl) return;

    const contextName = getContext()?.name2;
    if (!contextName) return;
    if (nameEl.textContent.trim() !== contextName.trim()) return;

    // We have the idle selfie message.
    waitingForIdleMessage = false;

    const caption = textEl.innerText.trim();
    mostRecentIdleCaption = caption;

    // DELETE the original message completely
    $(last).remove();

    if (!extension_settings.idle.selfieEnabled) return;

    const imgBlob = await generateGeminiImage(caption);

    let combinedContent = caption;

    if (imgBlob) {
        const url = URL.createObjectURL(imgBlob);
        combinedContent = `![selfie](${url})\n\n${caption}`;
    }

    // Post combined final message as character
    sendMessageAs('', `${contextName}\n${combinedContent}`);
});

// Attach observer
function activateObserver() {
    const target = document.getElementById('chat');
    if (target) {
        observer.observe(target, { childList: true, subtree: true });
    }
}

//––––––––––––––––––––––––––––––––––––––––––––
// SETTINGS HTML
//––––––––––––––––––––––––––––––––––––––––––––

async function loadSettingsHTML() {
    const html = await renderExtensionTemplateAsync(extensionName, 'dropdown');
    const container = document.getElementById('idle_container') ?? document.getElementById('extensions_settings2');
    $(container).append(html);
}

function updateSetting(elementId, property, isCheckbox = false) {
    let value = $(`#${elementId}`).val();
    if (isCheckbox) value = $(`#${elementId}`).prop('checked');
    if (property === 'prompts') value = value.split('\n');
    extension_settings.idle[property] = value;
    saveSettingsDebounced();
}

function attachUpdateListener(id, property, isCheckbox = false) {
    $(`#${id}`).on('input', debounce(() => updateSetting(id, property, isCheckbox), 250));
}

//––––––––––––––––––––––––––––––––––––––––––––
// IDLE LISTENERS
//––––––––––––––––––––––––––––––––––––––––––––

const debouncedActivityHandler = debounce((event) => {
    if ($(event.target).closest('#option_continue').length) return;

    resetIdleTimer();
    repeatCount = 0;
}, 250);

function attachIdleListeners() {
    $(document).on('click keypress', debouncedActivityHandler);
    document.addEventListener('keydown', debouncedActivityHandler);
}

function removeIdleListeners() {
    $(document).off('click keypress', debouncedActivityHandler);
    document.removeEventListener('keydown', debouncedActivityHandler);
}

function handleIdleEnabled() {
    if (!extension_settings.idle.enabled) {
        clearTimeout(idleTimer);
        removeIdleListeners();
    } else {
        resetIdleTimer();
        attachIdleListeners();
    }
}

function toggleIdle() {
    extension_settings.idle.enabled = !extension_settings.idle.enabled;
    $('#idle_enabled').prop('checked', extension_settings.idle.enabled);
    $('#idle_enabled').trigger('input');
    toastr.info(`Idle Selfie mode ${extension_settings.idle.enabled ? 'enabled' : 'disabled'}.`);
    resetIdleTimer();
}

//––––––––––––––––––––––––––––––––––––––––––––
// INIT
//––––––––––––––––––––––––––––––––––––––––––––

jQuery(async () => {
    await loadSettingsHTML();
    await loadSettings();
    setupListeners();
    if (extension_settings.idle.enabled) resetIdleTimer();
    activateObserver();
    registerSlashCommand('idle-selfie', toggleIdle, [], '– toggles Idle Selfie mode', true, true);
});

function setupListeners() {
    const list = [
        ['idle_timer', 'timer'],
        ['idle_prompts', 'prompts'],
        ['idle_use_continuation', 'useContinuation', true],
        ['idle_use_regenerate', 'useRegenerate', true],
        ['idle_use_impersonation', 'useImpersonation', true],
        ['idle_use_swipe', 'useSwipe', true],
        ['idle_enabled', 'enabled', true],
        ['idle_repeats', 'repeats'],
        ['idle_sendAs', 'sendAs'],
        ['idle_random_time', 'randomTime', true],
        ['idle_timer_min', 'timerMin'],
        ['idle_include_prompt', 'includePrompt', true],

        // NEW
        ['idle_gemini_api', 'geminiApiKey'],
        ['idle_gemini_model', 'geminiModel'],
        ['idle_selfie_enabled', 'selfieEnabled', true]
    ];

    list.forEach(([id, prop, check]) => attachUpdateListener(id, prop, check));

    $('#idle_enabled').on('input', debounce(handleIdleEnabled, 250));

    if (extension_settings.idle.enabled) attachIdleListeners();
}


