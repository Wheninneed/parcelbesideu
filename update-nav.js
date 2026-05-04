const fs = require('fs');
const files = ['index.html', 'about.html', 'package-holding.html', 'stores.html', 'online-shopping-1.html', 'online-shopping-2.html'];

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  content = content.replace(/<nav class="nav-links">[\s\S]*?<\/nav>/, `<nav class="nav-links">
        <a href="stores.html">Stores</a>
        <a href="faq.html">FAQ</a>
        <a href="about.html">About Us</a>
      </nav>`);
  fs.writeFileSync(f, content);
  console.log('Updated ' + f);
});
