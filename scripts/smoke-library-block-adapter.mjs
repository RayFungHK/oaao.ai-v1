/**
 * Lightweight checks for library-block-adapter (run in browser devtools or node --experimental-vm-modules).
 */
import { fromLibraryBlocks, toLibraryBlocks } from '../backbone/sites/oaaoai/oaaoai/library/default/webassets/js/library-block-adapter.js';

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

const roundTrip = toLibraryBlocks(
    fromLibraryBlocks([
        { type: 'heading', content: 'Title', level: 2 },
        { type: 'bullet_list', content: 'One\nTwo' },
        { type: 'table', content: '', meta: { rows: [['A', 'B'], ['1', '2']] } },
    ]),
);
assert(roundTrip[0].type === 'heading' && roundTrip[0].level === 2, 'heading level');
assert(roundTrip[1].type === 'bullet_list', 'bullet list');
assert(roundTrip[2].type === 'table', 'table preserved');
assert(Array.isArray(roundTrip[2].meta?.rows), 'table rows');

const quote = toLibraryBlocks([{ type: 'quote', content: 'Hello', meta: {} }]);
assert(quote[0].meta?.ruType === 'quote', 'quote ruType');

console.log('library-block-adapter OK');
