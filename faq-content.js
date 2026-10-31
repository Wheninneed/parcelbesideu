// Shared rendering policy for public FAQ answers and the admin editor.
// All rich text passes through the locally pinned DOMPurify build.
(function(root) {
  'use strict';

  var purifier = root.DOMPurify;
  var ready = false;
  var tags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'blockquote',
    'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ol', 'ul', 'li', 'a', 'img', 'span'];

  function safeUrl(value, image) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return '';
    value = value.trim();
    if (image && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+=*$/i.test(value)) return value;
    try {
      var url = new URL(value);
      var allowed = image ? ['http:', 'https:'] : ['http:', 'https:', 'mailto:', 'tel:'];
      if (allowed.indexOf(url.protocol) === -1 || url.username || url.password) return '';
      return url.href;
    } catch(e) {
      return '';
    }
  }

  function safeStyle(value) {
    var style = root.document.createElement('span').style;
    style.cssText = value;
    var result = [];
    ['color', 'background-color'].forEach(function(property) {
      var color = style.getPropertyValue(property).trim();
      // Keep Quill colors, without CSS variables, URLs, or arbitrary declarations.
      if (/^(?:#[a-f0-9]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d.,%+\-\s]+\))$/i.test(color)) {
        result.push(property + ': ' + color);
      }
    });
    var align = style.getPropertyValue('text-align').trim();
    if (/^(?:left|right|center|justify)$/.test(align)) result.push('text-align: ' + align);
    return result.join('; ');
  }

  if (purifier && purifier.isSupported && purifier.version === '3.4.13') {
    try {
      purifier.addHook('uponSanitizeAttribute', function(node, data) {
        if (data.attrName === 'href' || data.attrName === 'src') {
          var isImage = node.nodeName.toLowerCase() === 'img' && data.attrName === 'src';
          var isLink = node.nodeName.toLowerCase() === 'a' && data.attrName === 'href';
          var url = (isImage || isLink) ? safeUrl(data.attrValue, isImage) : '';
          if (url) data.attrValue = url;
          else data.keepAttr = false;
        } else if (data.attrName === 'style') {
          data.attrValue = safeStyle(data.attrValue);
          if (!data.attrValue) data.keepAttr = false;
        } else if (data.attrName === 'class') {
          data.attrValue = data.attrValue.split(/\s+/).filter(function(name) {
            return /^ql-(?:align-(?:center|right|justify)|direction-rtl|indent-[1-8]|size-(?:small|large|huge)|font-(?:serif|monospace)|syntax)$/.test(name);
          }).join(' ');
          if (!data.attrValue) data.keepAttr = false;
        }
      });
      purifier.addHook('afterSanitizeAttributes', function(node) {
        if (node.nodeName.toLowerCase() === 'a' && node.hasAttribute('href')) {
          node.setAttribute('rel', 'noopener noreferrer');
          if (/^https?:/.test(node.getAttribute('href'))) node.setAttribute('target', '_blank');
        }
      });
      ready = true;
    } catch(e) {
      ready = false;
    }
  }

  function render(container, value) {
    var text = value == null ? '' : String(value);
    if (ready) {
      try {
        var fragment = purifier.sanitize(text, {
          ALLOWED_TAGS: tags,
          ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style'],
          ALLOW_DATA_ATTR: false,
          ALLOW_ARIA_ATTR: false,
          RETURN_DOM_FRAGMENT: true
        });
        if (!fragment || fragment.nodeType !== 11) throw new Error('Expected sanitized fragment');
        container.replaceChildren(fragment);
        return true;
      } catch(e) {
        // Never fall back to inserting untrusted HTML.
      }
    }
    container.textContent = text;
    return false;
  }

  function plainText(value) {
    var container = root.document.createElement('div');
    render(container, value);
    return container.textContent || '';
  }

  root.ParcelFaqContent = Object.freeze({ render: render, plainText: plainText });
})(window);
