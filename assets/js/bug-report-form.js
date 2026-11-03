// Website contact form: "Report a bug" saves straight to the bug_reports table
// (reviewed on the admin Bug Reports page). Other topics keep the original
// behavior of opening the visitor's email app. The database resets any
// triage fields, so a visitor can only create a fresh "New" report.
(() => {
  "use strict";

  const form = document.getElementById("contactForm");
  if (!form) return;

  const topic = document.getElementById("contactTopic");
  const title = document.getElementById("bugTitle");
  const message = document.getElementById("contactMessage");
  const messageLabel = form.querySelector('label[for="contactMessage"]');
  const submit = form.querySelector(".contact-submit");
  const status = document.getElementById("contactStatus");
  const bugOnly = [...form.querySelectorAll("[data-bug-only]")];

  const defaults = {
    label: messageLabel.textContent,
    placeholder: message.placeholder,
    submit: submit.innerHTML
  };

  const showStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle("is-error", isError);
    status.hidden = false;
  };

  function syncTopic() {
    const bug = topic.value === "bug";
    bugOnly.forEach((field) => { field.hidden = !bug; });
    title.required = bug;
    messageLabel.textContent = bug ? "What happened?" : defaults.label;
    message.placeholder = bug ? "What were you doing, what did you expect, and what happened instead?" : defaults.placeholder;
    submit.innerHTML = bug ? 'Send bug report <span class="arrow" aria-hidden="true">→</span>' : defaults.submit;
    status.hidden = true;
  }

  topic.addEventListener("change", syncTopic);
  syncTopic();

  form.addEventListener("submit", async (event) => {
    if (topic.value !== "bug") return; // Questions keep using the email app.
    event.preventDefault();
    if (!form.reportValidity()) return;

    const db = window.NavAbleDB?.client;
    if (!db) {
      showStatus("We couldn't connect right now. Please email nav4ble@gmail.com instead.", true);
      return;
    }

    const text = (name) => form.elements[name]?.value.trim() || null;
    submit.disabled = true;
    submit.textContent = "Sending…";
    const { error } = await db.from("bug_reports").insert({
      title: text("bug_title"),
      description: text("message"),
      area: form.elements.bug_area.value,
      source: "Website",
      device_info: text("bug_device"),
      reporter_name: text("name"),
      reporter_email: text("email")
    });
    submit.disabled = false;

    if (error) {
      console.error("NavAble: bug report could not be sent.", error);
      submit.innerHTML = 'Send bug report <span class="arrow" aria-hidden="true">→</span>';
      showStatus("Your bug report couldn't be sent. Please try again, or email nav4ble@gmail.com.", true);
      return;
    }

    form.reset();
    topic.value = "bug";
    syncTopic();
    showStatus("Thank you! Your bug report was sent to the NavAble team.");
  });
})();
