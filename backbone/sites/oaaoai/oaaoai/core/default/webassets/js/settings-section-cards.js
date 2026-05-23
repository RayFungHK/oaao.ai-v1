/**

 * Settings / Preferences section layout — muted label + white card (Cursor-style).

 */



const ROW_PAD = '[padding:0.875rem_1.25rem]';

const FOOTER_PAD = '[padding:0.75rem_1.25rem]';

const STATUS_PAD = '[padding:0.625rem_1.25rem]';

const ROW_RULE = 'border-t-[1px] border-solid border-[var(--grid-line)]';

const CARD_BORDER = 'border-[1px] border-solid border-[var(--grid-line)]';



/** @returns {HTMLElement} */

export function settingsPageStack() {

    const el = document.createElement('div');

    el.className = 'flex flex-col gap-6 min-w-0 max-w-[42rem] w-full';



    return el;

}



/**

 * @param {string} title Section label above the card

 * @param {HTMLElement} card

 */

export function wrapSettingsSection(title, card) {

    const section = document.createElement('section');

    section.className = 'flex flex-col min-w-0 w-full';

    const heading = document.createElement('h3');

    heading.className =

        'text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold mb-2 mt-0';

    heading.textContent = title;

    section.append(heading, card);



    return section;

}



/** @returns {HTMLElement} */

export function settingsCard() {

    const card = document.createElement('div');

    card.className = `rounded-[10px] ${CARD_BORDER} bg-[var(--grid-paper)] overflow-hidden min-w-0 w-full`;



    return card;

}



/** Stack for card rows — use {@link settingsCardRow} with {@code withTopRule} after the first row. */

export function settingsCardRows() {

    const el = document.createElement('div');

    el.className = 'flex flex-col min-w-0';



    return el;

}



/**

 * @param {{

 *   label: string,

 *   description?: string,

 *   control?: HTMLElement | null,

 *   valueText?: string,

 * }} opts

 * @param {boolean} [withTopRule] pass true for every row after the first in a card

 */

export function settingsCardRow(opts, withTopRule = false) {

    const row = document.createElement('div');

    row.className = [

        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 min-w-0 min-h-[2.75rem]',

        ROW_PAD,

        withTopRule ? ROW_RULE : '',

    ]

        .filter(Boolean)

        .join(' ');



    const lead = document.createElement('div');

    lead.className = 'flex flex-col gap-0.5 min-w-0 flex-1';

    const label = document.createElement('div');

    label.className = 'text-[0.8125rem] fw-medium fg-[var(--grid-ink)] leading-snug';

    label.textContent = opts.label;

    lead.append(label);

    if (opts.description) {

        const desc = document.createElement('div');

        desc.className = 'text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug max-w-[28rem]';

        desc.textContent = opts.description;

        lead.append(desc);

    }



    row.append(lead);



    if (opts.control) {

        opts.control.classList.add('shrink-0', 'w-full', 'sm:w-auto', 'sm:min-w-[10rem]', 'sm:max-w-[20rem]');

        row.append(opts.control);

    } else if (opts.valueText != null) {

        const val = document.createElement('div');

        val.className =

            'text-[0.8125rem] fg-[var(--grid-ink-muted)] tabular-nums shrink-0 text-right leading-snug';

        val.textContent = opts.valueText;

        row.append(val);

    }



    return row;

}



/**

 * @param {HTMLElement | HTMLElement[]} actions

 */

export function settingsCardFooter(actions) {

    const footer = document.createElement('div');

    footer.className = [

        'flex flex-wrap items-center justify-end gap-2 min-w-0 min-h-[2.75rem]',

        FOOTER_PAD,

        ROW_RULE,

        'bg-[var(--grid-panel-bright)]/40',

    ].join(' ');



    const list = Array.isArray(actions) ? actions : [actions];

    for (const el of list) {

        if (el instanceof HTMLElement) footer.append(el);

    }



    return footer;

}



/**

 * @param {string} text

 * @param {'primary' | 'secondary'} [variant]

 */

export function settingsActionButton(text, variant = 'secondary') {

    const btn = document.createElement('button');

    btn.type = 'button';

    btn.textContent = text;

    btn.className =

        variant === 'primary'

            ? 'rounded-[8px] px-3.5 py-1.5 text-[0.8125rem] fw-medium fg-white bg-[var(--grid-accent)] border-0 cursor-pointer font-inherit hover:opacity-90'

            : 'rounded-[8px] px-3.5 py-1.5 text-[0.8125rem] fw-medium fg-[var(--grid-ink)] bg-[var(--grid-panel-bright)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25';



    return btn;

}



/** Standard text input for card rows. */

export function settingsCardInput(attrs = {}) {

    const input = document.createElement('input');

    input.className =

        'w-full rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] px-2.5 py-1.5 text-[0.8125rem] font-inherit bg-[var(--grid-panel-bright)] fg-[var(--grid-ink)] box-border min-h-[2.25rem]';

    if (attrs.name) input.name = String(attrs.name);

    if (attrs.value != null) input.value = String(attrs.value);

    if (attrs.type) input.type = String(attrs.type);

    if (attrs.required) input.required = true;

    if (attrs.minLength) input.minLength = Number(attrs.minLength);

    if (attrs.autocomplete) input.autocomplete = String(attrs.autocomplete);



    return input;

}



/** Standard select for card rows. */

export function settingsCardSelect(name) {

    const sel = document.createElement('select');

    sel.name = name;

    sel.className =

        'w-full rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] px-2.5 py-1.5 text-[0.8125rem] font-inherit bg-[var(--grid-panel-bright)] fg-[var(--grid-ink)] cursor-pointer box-border min-h-[2.25rem]';



    return sel;

}



/**

 * @param {string} msg

 * @param {boolean} [isError]

 */

export function settingsCardStatus(msg, isError = false) {

    const p = document.createElement('p');

    p.className = [

        'text-[0.75rem] m-0',

        STATUS_PAD,

        ROW_RULE,

        isError ? 'fg-[var(--grid-caution,#b45309)]' : 'fg-[var(--grid-ink-muted)]',

    ].join(' ');

    p.setAttribute('role', 'status');

    p.textContent = msg;



    return p;

}



/** @param {boolean} [isError] */

export function settingsCardStatusClass(isError = false) {

    return [

        'text-[0.75rem] m-0',

        STATUS_PAD,

        ROW_RULE,

        isError ? 'fg-[var(--grid-caution,#b45309)]' : 'fg-[var(--grid-ink-muted)]',

    ].join(' ');

}


