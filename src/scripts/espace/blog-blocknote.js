// The blog's block editor (BlockNote, React). Loaded only by /espace/blog/article/: public pages never get this code
// (scripts/verify.mjs checks it). Only the blocks the site knows how to show: paragraph, heading H2/H3, bulleted and
// numbered lists, quote, divider, our image block (with alt text and credit); bold, italic and links.
// What it saves is JSON; src/lib/blocks.js turns it into HTML for the site, through its own allowlist.
import { createElement as h, useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs, createHeadingBlockSpec,
  filterSuggestionItems, insertOrUpdateBlockForSlashMenu,
} from '@blocknote/core';
import { fr } from '@blocknote/core/locales';
import {
  useCreateBlockNote, createReactBlockSpec, getDefaultReactSlashMenuItems, SuggestionMenuController,
  FormattingToolbarController, FormattingToolbar, BlockTypeSelect, BasicTextStyleButton, CreateLinkButton,
  NestBlockButton, UnnestBlockButton, SideMenuController, SideMenu, AddBlockButton, DragHandleButton, DragHandleMenu, RemoveBlockItem,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/ariakit';
import '@blocknote/core/style.css';
import '@blocknote/ariakit/style.css';
import '../../styles/blog-editor.css';

// BlockNote fades a closing menu out by re-parsing a copy of its HTML. Our CSP refuses the style attributes in that copy
// (and logs an error); they only position an empty, zero-size anchor, so they are dropped from BlockNote's copies.
const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
Object.defineProperty(Element.prototype, 'innerHTML', {
  ...innerHTML,
  set(html) {
    innerHTML.set.call(this, typeof html === 'string' && html.includes('bn-') ? html.replace(/\sstyle="[^"]*"/g, '') : html);
  },
});

// what the image block needs from the page: upload a file, show a stored image (set by mountEditor)
let host = { upload: async () => '', imageUrl: () => null, imageError: () => null };

function ImageBlock({ block, editor }) {
  const { path, alt, credit } = block.props;
  const [state, setState] = useState('');
  const fileRef = useRef(null);
  const editable = editor.isEditable;
  const set = (props) => editor.updateBlock(block, { props });
  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setState('Préparation et envoi de l’image…');
    try {
      set({ path: await host.upload(file) });
      setState('');
    } catch (err) {
      setState(host.imageError(err) || 'L’image n’a pas pu être envoyée. Réessaie.');
    }
  };
  const field = (key, label, value) =>
    h('label', { className: 'bn-post-image-field' },
      h('span', null, label, !value.trim() && h('em', null, ' obligatoire')),
      h('input', { type: 'text', defaultValue: value, maxLength: key === 'alt' ? 300 : 120, disabled: !editable, onInput: (e) => set({ [key]: e.target.value }) }));
  const src = path && host.imageUrl(path);
  return h('div', { className: 'bn-post-image', contentEditable: false },
    src
      ? h('img', { src, alt: alt || '' })
      : path
        ? h('p', { className: 'bn-post-image-missing' }, 'Image enregistrée (aperçu indisponible ici).')
        : editable && h('button', { type: 'button', className: 'btn btn-ghost btn-small', onClick: () => fileRef.current?.click() }, 'Choisir une image (JPG, PNG ou WebP)'),
    h('input', { ref: fileRef, type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, onChange: choose }),
    state && h('p', { className: 'bn-post-image-state', role: 'status' }, state),
    path && field('alt', 'Texte alternatif (ce que montre l’image)', alt),
    path && field('credit', 'Crédit photo', credit));
}

// selectable: false: clicks and keys inside the block (its fields, its button) belong to the browser, and a click there
// never selects the whole block (the next key typed would otherwise replace it). It still moves and goes with the side menu.
const postImage = createReactBlockSpec(
  { type: 'image', propSchema: { path: { default: '' }, alt: { default: '' }, credit: { default: '' } }, content: 'none' },
  { meta: { selectable: false }, render: (props) => h(ImageBlock, props) },
);

const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: createHeadingBlockSpec({ levels: [2, 3], defaultLevel: 2, allowToggleHeadings: false }),
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    quote: defaultBlockSpecs.quote,
    divider: defaultBlockSpecs.divider,
    image: postImage(),
  },
  inlineContentSpecs: defaultInlineContentSpecs, // text and links
  styleSpecs: { bold: defaultStyleSpecs.bold, italic: defaultStyleSpecs.italic },
});

const imageIcon = h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': true },
  h('path', { fill: 'currentColor', d: 'M4 5h16v14H4zM6 7v8.6l3.5-3.6 2.5 2.5 3.5-4.5L18 13.3V7zm0 10h12v-.9l-2.5-2.8-3.4 4.3-2.6-2.6L6 17z' }));

const slashItems = (editor) => [
  ...getDefaultReactSlashMenuItems(editor).filter((item) => item.key !== 'emoji'),
  {
    key: 'post_image', title: 'Image', subtext: 'Photo ou dessin (JPG, PNG, WebP), avec texte alternatif et crédit',
    aliases: ['image', 'photo', 'img', 'dessin'], group: 'Médias', icon: imageIcon,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'image' }),
  },
];

function Editor({ initial, onReady, onChange }) {
  const [editable, setEditable] = useState(true);
  const editor = useCreateBlockNote({
    schema,
    dictionary: fr,
    initialContent: initial?.length ? initial : undefined,
    // Tiptap's <style> tag would be refused by the CSP: blog-editor.css has the same rules
    _tiptapOptions: { injectCSS: false },
  });
  useEffect(() => onReady(editor, setEditable), [editor]);
  return h(BlockNoteView, {
      editor, editable, theme: 'light', onChange, emojiPicker: false, slashMenu: false, formattingToolbar: false, sideMenu: false,
    },
    h(SuggestionMenuController, { triggerCharacter: '/', getItems: async (query) => filterSuggestionItems(slashItems(editor), query) }),
    h(FormattingToolbarController, {
      formattingToolbar: () => h(FormattingToolbar, null,
        h(BlockTypeSelect, { key: 'type' }),
        h(BasicTextStyleButton, { key: 'bold', basicTextStyle: 'bold' }),
        h(BasicTextStyleButton, { key: 'italic', basicTextStyle: 'italic' }),
        h(CreateLinkButton, { key: 'link' }),
        h(NestBlockButton, { key: 'nest' }),
        h(UnnestBlockButton, { key: 'unnest' })),
    }),
    h(SideMenuController, {
      sideMenu: (props) => h(SideMenu, props,
        h(AddBlockButton),
        h(DragHandleButton, { ...props, dragHandleMenu: () => h(DragHandleMenu, null, h(RemoveBlockItem, null, 'Supprimer le bloc')) })),
    }));
}

/**
 * Mounts the editor in `node`. opts: { blocks, onChange, upload(file) → path, imageUrl(path), imageError(err) }.
 * Resolves to { getBlocks(), setBlocks(blocks), setEditable(bool), focus() }.
 */
export function mountEditor(node, opts) {
  host = opts;
  return new Promise((resolve) => {
    createRoot(node).render(h(Editor, {
      initial: opts.blocks,
      onChange: () => opts.onChange?.(),
      onReady: (editor, setEditable) => resolve({
        getBlocks: () => editor.document,
        setBlocks: (blocks) => editor.replaceBlocks(editor.document, blocks?.length ? blocks : [{ type: 'paragraph' }]),
        setEditable,
        focus: () => editor.focus(),
      }),
    }));
  });
}
