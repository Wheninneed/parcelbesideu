// =============================================
// app.js — PUBLIC PAGES ONLY (index.html, about.html)
// Admin page is fully self-contained in admin.html
// =============================================
const SUPABASE_URL = 'https://ankpcatdvcumwdjwptvp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFua3BjYXRkdmN1bXdkandwdHZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODUwNjgsImV4cCI6MjA5MTg2MTA2OH0.lFN2Lov4Wp6gWLeXIIpcViz8Yv-V5i-iR0sLyJiAros';

(function() {
  // Mobile Menu
  var hamburger = document.querySelector('.hamburger');
  var navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function() {
      navLinks.classList.toggle('active');
    });
  }

  // --- PUBLIC DATA DISPLAY ---
  var businessHoursDisplay = document.getElementById('business-hours-content');
  var paymentMethodDisplay = document.getElementById('payment-method-content');
  var holidayAlertContainer = document.getElementById('holiday-alert-container');

  if (!businessHoursDisplay && !paymentMethodDisplay) return;

  if (!window.supabase) {
    console.error('Supabase CDN not loaded');
    if (paymentMethodDisplay) paymentMethodDisplay.textContent = 'Cash | Venmo | Paypal | Credit Card | Wire transfer';
    return;
  }

  var client;
  try {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch(e) {
    console.error('Supabase client creation failed:', e);
    return;
  }

  client.from('site_settings').select('*').then(function(result) {
    var data = result.data;
    var error = result.error;

    if (error) {
      console.error('Fetch error:', error.message);
      if (businessHoursDisplay) {
        businessHoursDisplay.innerHTML = '<li>MON - THU 13:00 - 19:00</li><li>FRIDAY 12:00 - 18:00</li><li>SAT - SUN CLOSED</li>';
      }
      if (paymentMethodDisplay) {
        paymentMethodDisplay.textContent = 'Cash | Venmo | Paypal | Credit Card | Wire transfer(Korean bank)';
      }
      return;
    }

    if (!data || data.length === 0) {
      console.warn('No data in site_settings');
      if (businessHoursDisplay) {
        businessHoursDisplay.innerHTML = '<li>MON - THU 13:00 - 19:00</li><li>FRIDAY 12:00 - 18:00</li><li>SAT - SUN CLOSED</li>';
      }
      if (paymentMethodDisplay) {
        paymentMethodDisplay.textContent = 'Cash | Venmo | Paypal | Credit Card | Wire transfer(Korean bank)';
      }
      return;
    }

    data.forEach(function(item) {
      // === BUSINESS HOURS ===
      if (item.id === 'business_hours' && businessHoursDisplay) {
        try {
          var parsed = JSON.parse(item.content);
          var dayIds = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
          var dayLabels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
          var html = '';
          var currentGroup = [];
          var prevStr = null;

          for (var i = 0; i < dayIds.length; i++) {
            var info = parsed.regular[dayIds[i]] || { closed: true };
            var str = info.closed ? 'CLOSED' : (info.open + ' - ' + info.close);

            if (str === prevStr) {
              currentGroup.push(dayLabels[i]);
            } else {
              if (currentGroup.length > 0) {
                var title = currentGroup.length > 1
                  ? currentGroup[0] + ' - ' + currentGroup[currentGroup.length - 1]
                  : currentGroup[0];
                if (title === 'FRI') title = 'FRIDAY';
                if (title === 'SAT') title = 'SATURDAY';
                if (title === 'SUN') title = 'SUNDAY';
                html += '<li>' + title + ' ' + prevStr + '</li>';
              }
              currentGroup = [dayLabels[i]];
              prevStr = str;
            }
          }
          if (currentGroup.length > 0) {
            var lastTitle = currentGroup.length > 1
              ? currentGroup[0] + ' - ' + currentGroup[currentGroup.length - 1]
              : currentGroup[0];
            if (lastTitle === 'FRI') lastTitle = 'FRIDAY';
            if (lastTitle === 'SAT') lastTitle = 'SATURDAY';
            if (lastTitle === 'SUN') lastTitle = 'SUNDAY';
            html += '<li>' + lastTitle + ' ' + prevStr + '</li>';
          }
          businessHoursDisplay.innerHTML = html;

          // Holiday Alert
          if (holidayAlertContainer && parsed.holidays && parsed.holidays.length > 0) {
            var today = new Date();
            var yyyy = today.getFullYear();
            var mm = String(today.getMonth() + 1).padStart(2, '0');
            var dd = String(today.getDate()).padStart(2, '0');
            var todayStr = yyyy + '-' + mm + '-' + dd;

            var upcoming = parsed.holidays.filter(function(h) { return h >= todayStr; }).sort();
            if (upcoming.length > 0) {
              var datesHtml = upcoming.map(function(d) { return '<b>' + d + '</b>'; }).join(', ');
              holidayAlertContainer.innerHTML =
                '<div style="background-color: #fef2f2; color: #991b1b; padding: 16px; border-radius: 8px; margin-bottom: 24px; border: 1px solid #f87171;">'
                + '<h4 style="margin: 0 0 8px 0; font-size: 18px;">⚠️ Notice: Temporary Closure</h4>'
                + 'We will be closed on: <span style="font-size: 16px;">' + datesHtml + '</span>'
                + '</div>';
            }
          }
        } catch(e) {
          // Fallback: show raw content
          businessHoursDisplay.innerHTML = '<li>' + item.content + '</li>';
        }
      }

      // === PAYMENT METHOD ===
      if (item.id === 'payment_method' && paymentMethodDisplay) {
        try {
          var pmParsed = JSON.parse(item.content);
          var active = Object.keys(pmParsed).filter(function(k) { return pmParsed[k]; });
          paymentMethodDisplay.textContent = active.join(' | ');
        } catch(e) {
          paymentMethodDisplay.textContent = item.content;
        }
      }
    });
  }).catch(function(err) {
    console.error('Network error:', err);
  });
})();
