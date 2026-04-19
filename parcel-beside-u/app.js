// --- SUPABASE CONFIGURATION ---
// IMPORTANT: Please replace these variables with your actual Supabase project URL and ANON KEY
const SUPABASE_URL = 'https://ankpcatdvcumwdjwptvp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFua3BjYXRkdmN1bXdkandwdHZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODUwNjgsImV4cCI6MjA5MTg2MTA2OH0.lFN2Lov4Wp6gWLeXIIpcViz8Yv-V5i-iR0sLyJiAros';

// Initialize Supabase only if keys are present
let supabase = null;
if (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && typeof supabaseClient !== 'undefined' || window.supabase) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

document.addEventListener('DOMContentLoaded', async () => {
  // Mobile Menu Logic
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('active');
    });
  }

  // --- PUBLIC DISPLAY LOGIC ---
  if (supabase) {
    const businessHoursDisplay = document.getElementById('business-hours-content');
    const paymentMethodDisplay = document.getElementById('payment-method-content');

    // Only fetch if these elements exist on the current page (index.html or about.html)
    if (businessHoursDisplay || paymentMethodDisplay) {
      try {
        const { data, error } = await supabase
          .from('site_settings')
          .select('*');

        if (data && !error) {
          data.forEach(item => {
            if (item.id === 'business_hours' && businessHoursDisplay) {
              businessHoursDisplay.innerHTML = item.content;
            }
            if (item.id === 'payment_method' && paymentMethodDisplay) {
              paymentMethodDisplay.innerHTML = item.content;
            }
          });
        }
      } catch (err) {
        console.error('Error fetching settings:', err);
      }
    }
  }

  // --- ADMIN PAGE LOGIC ---
  const loginSection = document.getElementById('login-section');
  const dashboardSection = document.getElementById('dashboard-section');

  if (loginSection && dashboardSection) {
    if (!supabase) {
      document.getElementById('login-error').innerText = 'System Error: Supabase keys not configured in app.js!';
      return;
    }

    // Check if already logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      showDashboard();
    }

    // Login Handler
    const loginBtn = document.getElementById('login-btn');
    loginBtn.addEventListener('click', async () => {
      const email = document.getElementById('admin-email').value;
      const password = document.getElementById('admin-password').value;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (error) {
        document.getElementById('login-error').innerText = error.message;
      } else {
        showDashboard();
      }
    });

    // Logout Handler
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await supabase.auth.signOut();
      loginSection.classList.remove('hidden');
      dashboardSection.classList.add('hidden');
    });

    // Save Settings
    document.getElementById('save-btn').addEventListener('click', async () => {
      const statusText = document.getElementById('save-status');
      statusText.innerText = 'Saving...';

      const hoursHtml = document.getElementById('edit-hours').value;
      const paymentHtml = document.getElementById('edit-payment').value;

      const { error: err1 } = await supabase.from('site_settings').update({ content: hoursHtml }).eq('id', 'business_hours');
      const { error: err2 } = await supabase.from('site_settings').update({ content: paymentHtml }).eq('id', 'payment_method');

      if (err1 || err2) {
        statusText.style.color = 'red';
        statusText.innerText = 'Error saving changes: ' + (err1?.message || err2?.message);
      } else {
        statusText.style.color = 'green';
        statusText.innerText = 'Changes saved successfully! Refresh the live site to see them.';
      }
    });

    async function showDashboard() {
      loginSection.classList.add('hidden');
      dashboardSection.classList.remove('hidden');

      // Fetch current values
      const { data, error } = await supabase.from('site_settings').select('*');
      if (data) {
        data.forEach(item => {
          if (item.id === 'business_hours') document.getElementById('edit-hours').value = item.content;
          if (item.id === 'payment_method') document.getElementById('edit-payment').value = item.content;
        });
      }
    }
  }
});
