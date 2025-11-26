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
    repeats: 2, // 0 = infinite
    sendAs: 'user',
    randomTime: false,
    timerMin: 60, // fixed from timeMin -> timerMin
    includePrompt: false,
};


//TODO: Can we make this a generic function?
/**
 * Load the extension settings and set defaults if they don't exist.
 */
async function loadSettings() {
    if (!extension_settings.idle) {
        console.log('Creating extension_settings.idle');
        extension_settings.idle = {};
    }
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!extension_settings.idle.hasOwnProperty(key)) {
            console.log(`Setting default for: ${key}`);
            extension_settings.idle[key] = value;
        }
    }
    populateUIWithSettings();
}

//TODO: Can we make this a generic function too?
/**
 * Populate the UI components with values from the extension settings.
 */
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
}


/**
 * Reset the idle timer based on the extension settings and context.
 */
function resetIdleTimer() {
    console.debug('Resetting idle timer');
    if (idleTimer) clearTimeout(idleTimer);
    let context = getContext();
    if (!context.characterId && !context.groupID) return;
    if (!extension_settings.idle.enabled) return;
    if (extension_settings.idle.randomTime) {
        // ensure these are ints
        let min = extension_settings.idle.timerMin;
        let max = extension_settings.idle.timer;
        min = parseInt(min);
        max = parseInt(max);
        let randomTime = (Math.random() * (max - min + 1)) + min;
        idleTimer = setTimeout(sendIdlePrompt, 1000 * randomTime);
    } else {
        idleTimer = setTimeout(sendIdlePrompt, 1000 * extension_settings.idle.timer);
    }
}

/**
 * Build a system prompt that tells the AI to send a short, in-world selfie-style message.
 * @param {string} basePrompt - A flavor prompt from the idle prompts list.
 */
function buildSelfieSystemPrompt(basePrompt) {
    const context = getContext();
    const charName = (context && context.name2) ? context.name2 : 'the character';

    return `
You are roleplaying as ${charName} in the current scene.

The user has been idle for a while.
Your next message should be a short, first-person, in-world "selfie" style message.

Strict rules:
- Write from ${charName}'s first-person perspective ("I").
- ONE single paragraph only.
- 1–3 sentences total.
- Maximum ~60 words.
- Do NOT repeat the same sentence or description.
- Describe a selfie or a moment right after taking a selfie.
- Include pose, facial expression, outfit, setting, and overall vibe/mood.
- Stay fully in character and in-world.
- Do NOT mention cameras, prompts, AI, or that you were instructed to do this.
${basePrompt ? `- Use this extra flavor as inspiration: ${basePrompt}` : ''}
`.trim();
}

/**
 * Send a random idle prompt to the AI based on the extension settings.
 * Now: sends a selfie-style system prompt instead of just a text fragment.
 */
async function sendIdlePrompt() {
    if (!extension_settings.idle.enabled) return;

    // Check repeat conditions and waiting for a response
    if (repeatCount >= extension_settings.idle.repeats || $('#mes_stop').is(':visible')) {
        resetIdleTimer();
        return;
    }

    // Pick one of the existing idle prompts as "flavor" for the selfie
    const basePrompt = extension_settings.idle.prompts[
        Math.floor(Math.random() * extension_settings.idle.prompts.length)
    ];

    const selfieSystemPrompt = buildSelfieSystemPrompt(basePrompt);

    console.debug('Sending idle selfie system prompt');
    sendPrompt(selfieSystemPrompt);

    repeatCount++;
    resetIdleTimer();
}


/**
 * Add our prompt to the chat and then send the chat to the backend.
 * @param {string} sendAs - The type of message to send. "user", "char", or "sys".
 * @param {string} prompt - The prompt text to send to the AI.
 */
function sendLoud(sendAs, prompt) {
    if (sendAs === 'user') {
        prompt = substituteParams(prompt);

        $('#send_textarea').val(prompt);

        // Set the focus back to the textarea
        $('#send_textarea').focus();

        $('#send_but').trigger('click');
    } else if (sendAs === 'char') {
        sendMessageAs('', `${getContext().name2}\n${prompt}`);
        promptQuietForLoudResponse(sendAs, '');
    } else if (sendAs === 'sys') {
        sendNarratorMessage('', prompt);
        promptQuietForLoudResponse(sendAs, '');
    }
    else {
        console.error(`Unknown sendAs value: ${sendAs}`);
    }
}

/**
 * Send the provided prompt to the AI. Determines method based on continuation setting.
 * @param {string} prompt - The prompt text to send to the AI.
 */
function sendPrompt(prompt) {
    clearTimeout(idleTimer);
    $('#send_textarea').off('input');

    if (extension_settings.idle.useRegenerate) {
        $('#option_regenerate').trigger('click');
        console.debug('Sending idle regenerate');
    } else if (extension_settings.idle.useContinuation) {
        $('#option_continue').trigger('click');
        console.debug('Sending idle continuation');
    } else if (extension_settings.idle.useImpersonation) {
        $('#option_impersonate').trigger('click');
        console.debug('Sending idle impersonation');
    } else if (extension_settings.idle.useSwipe) {
        $('.last_mes .swipe_right').click();
        console.debug('Sending idle swipe');
    } else {
        console.debug('Sending idle prompt');
        console.log(extension_settings.idle);
        if (extension_settings.idle.includePrompt) {
            sendLoud(extension_settings.idle.sendAs, prompt);
        }
        else {
            promptQuietForLoudResponse(extension_settings.idle.sendAs, prompt);
        }
    }
}

/**
 * Load the settings HTML and append to the designated area.
 */
async function loadSettingsHTML() {
    const settingsHtml = await renderExtensionTemplateAsync(extensionName, 'dropdown');
    const getContainer = () => $(document.getElementById('idle_container') ?? document.getElementById('extensions_settings2'));
    getContainer().append(settingsHtml);
}

/**
 * Update a specific setting based on user input.
 * @param {string} elementId - The HTML element ID tied to the setting.
 * @param {string} property - The property name in the settings object.
 * @param {boolean} [isCheckbox=false] - Whether the setting is a checkbox.
 */
function updateSetting(elementId, property, isCheckbox = false) {
    let value = $(`#${elementId}`).val();
    if (isCheckbox) {
        value = $(`#${elementId}`).prop('checked');
    }

    if (property === 'prompts') {
        value = value.split('\n');
    }

    extension_settings.idle[property] = value;
    saveSettingsDebounced();
}

/**
 * Attach an input listener to a UI component to update the corresponding setting.
 * @param {string} elementId - The HTML element ID tied to the setting.
 * @param {string} property - The property name in the settings object.
 * @param {boolean} [isCheckbox=false] - Whether the setting is a checkbox.
 */
function attachUpdateListener(elementId, property, isCheckbox = false) {
    $(`#${elementId}`).on('input', debounce(() => {
        updateSetting(elementId, property, isCheckbox);
    }, 250));
}

/**
 * Handle the enabling or disabling of the idle extension.
 * Adds or removes the idle listeners based on the checkbox's state.
 */
function handleIdleEnabled() {
    if (!extension_settings.idle.enabled) {
        clearTimeout(idleTimer);
        removeIdleListeners();
    } else {
        resetIdleTimer();
        attachIdleListeners();
    }
}


/**
 * Setup input listeners for the various settings and actions related to the idle extension.
 */
function setupListeners() {
    const settingsToWatch = [
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
    ];
    settingsToWatch.forEach(setting => {
        attachUpdateListener(...setting);
    });

    // Idleness listeners, could be made better
    $('#idle_enabled').on('input', debounce(handleIdleEnabled, 250));

    // Add the idle listeners initially if the idle feature is enabled
    if (extension_settings.idle.enabled) {
        attachIdleListeners();
    }

    // Make continuation, regenerate, impersonation, and swipe mutually exclusive
    $('#idle_use_continuation, #idle_use_regenerate, #idle_use_impersonation, #idle_use_swipe').on('change', function() {
        const checkboxId = $(this).attr('id');

        if ($(this).prop('checked')) {
            // Uncheck the other options
            if (checkboxId !== 'idle_use_continuation') {
                $('#idle_use_continuation').prop('checked', false);
                extension_settings.idle.useContinuation = false;
            }

            if (checkboxId !== 'idle_use_regenerate') {
                $('#idle_use_regenerate').prop('checked', false);
                extension_settings.idle.useRegenerate = false;
            }

            if (checkboxId !== 'idle_use_impersonation') {
                $('#idle_use_impersonation').prop('checked', false);
                extension_settings.idle.useImpersonation = false;
            }

            if (checkboxId !== 'idle_use_swipe') {
                $('#idle_use_swipe').prop('checked', false);
                extension_settings.idle.useSwipe = false;
            }

            // Save the changes
            saveSettingsDebounced();
        }
    });

    //show/hide timer min parent div
    $('#idle_random_time').on('input', function () {
        if ($(this).prop('checked')) {
            $('#idle_timer_min').parent().show();
        } else {
            $('#idle_timer_min').parent().hide();
        }

        $('#idle_timer').trigger('input');
    });

    // if we're including the prompt, hide raw from the sendAs dropdown
    $('#idle_include_prompt').on('input', function () {
        if ($(this).prop('checked')) {
            $('#idle_sendAs option[value="raw"]').hide();
        } else {
            $('#idle_sendAs option[value="raw"]').show();
        }
    });

    //make sure timer min is less than timer
    $('#idle_timer').on('input', function () {
        if ($('#idle_random_time').prop('checked')) {
            if ($(this).val() < $('#idle_timer_min').val()) {
                $('#idle_timer_min').val($(this).val());
                $('#idle_timer_min').trigger('input');
            }
        }
    });

}

const debouncedActivityHandler = debounce((event) => {
    // Check if the event target (or any of its parents) has the id "option_continue"
    if ($(event.target).closest('#option_continue').length) {
        return; // Do not proceed if the click was on (or inside) an element with id "option_continue"
    }

    console.debug('Activity detected, resetting idle timer');
    resetIdleTimer();
    repeatCount = 0;
}, 250);

function attachIdleListeners() {
    $(document).on('click keypress', debouncedActivityHandler);
    document.addEventListener('keydown', debouncedActivityHandler);
}

/**
 * Remove idle-specific listeners.
 */
function removeIdleListeners() {
    $(document).off('click keypress', debouncedActivityHandler);
    document.removeEventListener('keydown', debouncedActivityHandler);
}

function toggleIdle() {
    extension_settings.idle.enabled = !extension_settings.idle.enabled;
    $('#idle_enabled').prop('checked', extension_settings.idle.enabled);
    $('#idle_enabled').trigger('input');
    toastr.info(`Idle Selfie mode ${extension_settings.idle.enabled ? 'enabled' : 'disabled'}.`);
    resetIdleTimer();
}

jQuery(async () => {
    await loadSettingsHTML();
    loadSettings();
    setupListeners();
    if (extension_settings.idle.enabled) {
        resetIdleTimer();
    }
    // once the doc is ready, check if random time is checked and hide/show timer min
    if ($('#idle_random_time').prop('checked')) {
        $('#idle_timer_min').parent().show();
    }
    // NOTE: changed slash command name so it doesn't collide with original Idle
    registerSlashCommand('idle-selfie', toggleIdle, [], '– toggles Idle Selfie mode', true, true);
});
