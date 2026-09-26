(() => {
  "use strict";

  const config = window.MODULE_CONFIG;
  const projectReady = Boolean(
    config && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl || "") &&
    /^sb_publishable_/i.test(config.supabasePublishableKey || "") && window.supabase,
  );
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const recordKey = "group2-ai-ipe-v2";
  let client = null;
  let activeUser = null;
  let remoteProgress = null;
  let officialCertificate = null;
  let syncTimer = null;

  function assignStableFieldIds() {
    ["a1score", "a2score", "a3score"].forEach((className) => {
      document.querySelectorAll(`.${className}`).forEach((node, index) => {
        if (!node.id) node.id = `${className}-${index + 1}`;
      });
    });
  }

  function addOnlineInterface() {
    const start = $("start");
    start.insertAdjacentHTML("afterbegin", `
      <div class="card accent no-print" id="accountPanel" aria-live="polite">
        <h3>Secure learner record</h3>
        <p class="small" id="accountMessage">Sign in with email to save an encrypted-in-transit record, submit it for review, and receive a registered certificate.</p>
        <div id="signedOutControls" class="grid g2">
          <div><label for="authName">Full name for your certificate</label><input id="authName" autocomplete="name" placeholder="Enter your name as it should appear"></div>
          <div><label for="authEmail">Email address</label><input id="authEmail" type="email" autocomplete="email" placeholder="you@example.org"></div>
          <div style="grid-column:1/-1"><button type="button" id="sendMagicLink">Email me a secure sign-in link</button><p class="small">No password is required. Your learning evidence is visible only to you and assigned reviewers.</p></div>
        </div>
        <div id="signedInControls" class="hidden"><p><strong id="signedInName"></strong> <span id="signedInEmail" class="small"></span></p><button type="button" id="saveCloudRecord" class="secondary">Save secure record</button><button type="button" id="requestReview" class="warm">Submit for facilitator review</button><button type="button" id="signOut" class="outline">Sign out</button><p id="reviewStatus" class="small"></p></div>
      </div>`);

    const certificate = $("certificate");
    certificate.insertAdjacentHTML("beforeend", `
      <div class="card gold no-print" id="certificateVerification" style="margin-top:1rem">
        <h3>Verify a certificate</h3>
        <p class="small">Enter the certificate code exactly as shown. Verification returns only the certificate holder, module and issuance details.</p>
        <label for="verifyCertificateCode">Certificate code</label>
        <input id="verifyCertificateCode" autocomplete="off" placeholder="FAIMER-AIIPE-2026-XXXXXXXXXX">
        <button type="button" id="verifyCertificateButton" class="secondary">Verify certificate</button>
        <div id="verifyCertificateResult" class="feedback" role="status"></div>
      </div>`);
  }

  function setMessage(message, tone = "") {
    const target = $("accountMessage");
    target.textContent = message;
    target.className = `small ${tone}`;
  }

  function recordSnapshot() {
    const record = window.collect ? window.collect() : { fields: {} };
    record.version = "November 2026 AI IPE interactive module — secure record";
    record.savedAt = new Date().toISOString();
    record.completion = (window.moduleChecks ? window.moduleChecks() : []).map(({ label, done }) => ({ label, done }));
    return record;
  }

  function requiredEvidenceComplete() {
    const checks = window.moduleChecks ? window.moduleChecks() : [];
    return checks.length >= 7 && checks.slice(0, 7).every((item) => item.done);
  }

  function learnerName() {
    return String($("certNameInput")?.value || $("authName")?.value || "").trim();
  }

  function displayReviewStatus() {
    const status = $("reviewStatus");
    if (!activeUser) return;
    const state = remoteProgress?.completion_status || "draft";
    const note = remoteProgress?.review_note;
    const messages = {
      draft: "Your secure record is a draft. Complete all learning evidence before submitting it.",
      submitted: "Submitted for facilitator review. You can still view your record while it is reviewed.",
      needs_revision: `Revision requested${note ? `: ${note}` : "."}`,
      approved: "Approved. Your registered certificate is ready below.",
    };
    status.textContent = messages[state] || "Your record is ready to save.";
  }

  function renderOfficialCertificate(certificate) {
    officialCertificate = certificate;
    if (!certificate) return;
    $("certNameInput").value = certificate.participant_name;
    $("certIdInput").value = certificate.certificate_code;
    $("certDateInput").value = certificate.issued_on;
    $("verifierInput").value = certificate.verifier_name;
    $("certVerify").checked = true;
    ["certIdInput", "certDateInput", "verifierInput", "certVerify", "confirmReviewed"].forEach((id) => { $(id).disabled = true; });
    window.updateProgress?.();
  }

  function overrideCertificateGate() {
    const earlier = window.syncCertificate;
    window.syncCertificate = function () {
      earlier?.();
      if (!officialCertificate) return;
      const certificate = officialCertificate;
      $("certName").textContent = certificate.participant_name;
      $("certId").textContent = certificate.certificate_code;
      $("certVerifier").textContent = certificate.verifier_name;
      $("certDate").textContent = new Date(`${certificate.issued_on}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
      const status = $("certificateStatus");
      status.textContent = "Registered certificate ready. Download the PDF or print a copy; the certificate code can be verified online.";
      status.className = "cert-status";
      $("printCertificateButton").disabled = false;
      const pdf = $("downloadCertificateButton");
      if (pdf) pdf.disabled = false;
    };
  }

  async function loadCertificate() {
    if (!activeUser) return;
    const { data, error } = await client
      .from("ai_ipe_module_certificates")
      .select("participant_name, certificate_code, issued_on, verifier_name")
      .eq("user_id", activeUser.id)
      .maybeSingle();
    if (error) throw error;
    if (data) renderOfficialCertificate(data);
  }

  async function loadRemoteRecord() {
    if (!activeUser) return;
    const { data, error } = await client
      .from("ai_ipe_module_progress")
      .select("user_id, learner_name, learner_record, completion_status, submitted_at, review_note, reviewed_at, updated_at")
      .eq("user_id", activeUser.id)
      .maybeSingle();
    if (error) throw error;
    remoteProgress = data || null;
    if (data?.learner_record) {
      const local = JSON.parse(localStorage.getItem(recordKey) || "null");
      const remoteStamp = Date.parse(data.learner_record.savedAt || data.updated_at || 0);
      const localStamp = Date.parse(local?.savedAt || 0);
      if (!local || remoteStamp > localStamp) {
        localStorage.setItem(recordKey, JSON.stringify(data.learner_record));
        window.apply?.(data.learner_record);
      }
      if (!$("certNameInput").value) $("certNameInput").value = data.learner_name;
    }
    await loadCertificate();
    displayReviewStatus();
    window.updateProgress?.();
  }

  async function saveSecureRecord({ quiet = false } = {}) {
    if (!activeUser) throw new Error("Sign in before saving a secure record.");
    const name = learnerName();
    if (name.length < 2) throw new Error("Enter your full name for the certificate before saving.");
    const payload = recordSnapshot();
    const { error } = await client.from("ai_ipe_module_progress").upsert({
      user_id: activeUser.id,
      learner_name: name,
      learner_record: payload,
    }, { onConflict: "user_id" });
    if (error) throw error;
    localStorage.setItem(recordKey, JSON.stringify(payload));
    if (!quiet) setMessage("Secure record saved. Continue working or submit when all evidence is complete.", "good");
  }

  function queueSecureSave() {
    if (!activeUser) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      saveSecureRecord({ quiet: true }).catch((error) => setMessage(`Secure save paused: ${error.message}`, "needs"));
    }, 900);
  }

  async function submitForReview() {
    if (!requiredEvidenceComplete()) throw new Error("Complete the first seven evidence sections before submitting for review.");
    await saveSecureRecord({ quiet: true });
    const { error } = await client.from("ai_ipe_module_progress")
      .update({ completion_status: "submitted", submitted_at: new Date().toISOString() })
      .eq("user_id", activeUser.id);
    if (error) throw error;
    await loadRemoteRecord();
    setMessage("Your record has been submitted for facilitator review.", "good");
  }

  async function sendMagicLink() {
    const email = String($("authEmail").value || "").trim();
    const name = String($("authName").value || "").trim();
    if (!name || !email) throw new Error("Enter both your full name and email address.");
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.href.split("#")[0],
        data: { display_name: name, requested_role: "student" },
      },
    });
    if (error) throw error;
    setMessage("A secure sign-in link has been emailed. Open it in this browser to continue.", "good");
  }

  async function renderSession(session) {
    activeUser = session?.user || null;
    $("signedOutControls").classList.toggle("hidden", Boolean(activeUser));
    $("signedInControls").classList.toggle("hidden", !activeUser);
    if (!activeUser) {
      remoteProgress = null;
      officialCertificate = null;
      setMessage(projectReady ? "Sign in with email to save and submit an official completion record." : "Secure record service is being configured. Local browser saving remains available.");
      return;
    }
    const displayName = activeUser.user_metadata?.display_name || activeUser.email?.split("@")[0] || "Signed-in learner";
    $("signedInName").textContent = displayName;
    $("signedInEmail").textContent = activeUser.email ? `(${activeUser.email})` : "";
    if (!$("certNameInput").value) $("certNameInput").value = displayName;
    await loadRemoteRecord();
    setMessage("Your account is connected. Learning evidence is saved securely when you edit.", "good");
    await maybeShowReviewerConsole();
  }

  async function maybeShowReviewerConsole() {
    const { data, error } = await client.rpc("is_ai_ipe_module_reviewer");
    if (error || !data || $("reviewerConsole")) return;
    document.querySelector("main").insertAdjacentHTML("beforeend", `
      <section id="reviewerConsole" class="no-print"><h2>Facilitator review console</h2>
      <p class="lead">Review submitted learner records, request a specific revision, or issue a registered certificate. Approval does not alter the learner's evidence.</p>
      <button type="button" id="refreshReviews" class="secondary">Refresh submitted records</button>
      <div id="reviewRows" class="grid" style="margin-top:1rem"></div></section>`);
    $("refreshReviews").addEventListener("click", () => refreshReviews());
    $("reviewRows").addEventListener("click", reviewAction);
    await refreshReviews();
  }

  async function refreshReviews() {
    const area = $("reviewRows");
    if (!area) return;
    area.textContent = "Loading submitted records…";
    const { data, error } = await client.from("ai_ipe_module_progress")
      .select("user_id, learner_name, learner_record, completion_status, submitted_at, review_note")
      .in("completion_status", ["submitted", "needs_revision"])
      .order("submitted_at", { ascending: true });
    if (error) { area.textContent = `Unable to load records: ${error.message}`; return; }
    if (!data?.length) { area.textContent = "No records currently need review."; return; }
    area.innerHTML = data.map((record) => {
      const completion = (record.learner_record?.completion || []).filter((item) => item.done).length;
      return `<article class="card accent"><h3>${escapeHtml(record.learner_name)}</h3><p class="small">${escapeHtml(record.completion_status)} · ${completion}/8 checklist items · submitted ${record.submitted_at ? new Date(record.submitted_at).toLocaleString() : "not recorded"}</p>${record.review_note ? `<p><strong>Previous note:</strong> ${escapeHtml(record.review_note)}</p>` : ""}<div class="footer-actions"><button type="button" data-review="evidence" data-user="${record.user_id}" class="outline">Download evidence</button><button type="button" data-review="return" data-user="${record.user_id}" class="warm">Request revision</button><button type="button" data-review="approve" data-user="${record.user_id}">Approve and issue certificate</button></div></article>`;
    }).join("");
    window.__aiIpeReviewerRecords = Object.fromEntries(data.map((record) => [record.user_id, record]));
  }

  async function reviewAction(event) {
    const button = event.target.closest("button[data-review]");
    if (!button) return;
    const userId = button.dataset.user;
    const action = button.dataset.review;
    const record = window.__aiIpeReviewerRecords?.[userId];
    if (!record) return;
    if (action === "evidence") {
      const blob = new Blob([JSON.stringify(record.learner_record, null, 2)], { type: "application/json" });
      const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `AI_IPE_${record.learner_name.replace(/[^a-z0-9]+/gi, "_")}_evidence.json`; link.click(); URL.revokeObjectURL(link.href); return;
    }
    const note = window.prompt(action === "return" ? "Revision guidance for the learner:" : "Optional approval note:", record.review_note || "");
    if (note === null) return;
    button.disabled = true;
    try {
      if (action === "return") {
        const { error } = await client.rpc("return_ai_ipe_module_completion", { p_learner_id: userId, p_review_note: note });
        if (error) throw error;
      } else {
        const { error } = await client.rpc("approve_ai_ipe_module_completion", { p_learner_id: userId, p_review_note: note });
        if (error) throw error;
      }
      await refreshReviews();
    } catch (error) {
      window.alert(`Review action could not be completed: ${error.message}`);
      button.disabled = false;
    }
  }

  async function verifyCertificate() {
    const code = String($("verifyCertificateCode").value || "").trim().toUpperCase();
    const result = $("verifyCertificateResult");
    result.textContent = "Checking the certificate register…";
    result.className = "feedback good";
    try {
      const response = await fetch(`${config.supabaseUrl}/functions/v1/verify-ai-ipe-certificate`, {
        method: "POST",
        headers: { apikey: config.supabasePublishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ certificateCode: code }),
      });
      const data = await response.json();
      if (!data.valid) throw new Error(data.message || "No active certificate was found.");
      result.innerHTML = `<strong>Verified</strong><br>${escapeHtml(data.participantName)} completed <em>${escapeHtml(data.moduleTitle)}</em> (${escapeHtml(data.modulePeriod)}). Issued ${escapeHtml(data.issuedOn)} and verified by ${escapeHtml(data.verifierName)}.`;
      result.className = "feedback good";
    } catch (error) {
      result.textContent = error.message || "Certificate verification failed.";
      result.className = "feedback needs";
    }
  }

  async function boot() {
    assignStableFieldIds();
    addOnlineInterface();
    overrideCertificateGate();
    ["certIdInput", "certDateInput", "verifierInput", "certVerify", "confirmReviewed"].forEach((id) => { $(id).disabled = true; });
    const confirmLabel = $("confirmReviewed")?.closest("label");
    if (confirmLabel) confirmLabel.append(" Facilitator confirmation is recorded securely after review.");
    document.addEventListener("input", queueSecureSave);
    document.addEventListener("change", queueSecureSave);

    if (!projectReady) {
      $("sendMagicLink").disabled = true;
      $("verifyCertificateButton").disabled = true;
      setMessage("Secure record service is being configured. Local browser saving remains available.", "needs");
      return;
    }
    client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
    $("sendMagicLink").addEventListener("click", () => sendMagicLink().catch((error) => setMessage(error.message, "needs")));
    $("saveCloudRecord").addEventListener("click", () => saveSecureRecord().catch((error) => setMessage(error.message, "needs")));
    $("requestReview").addEventListener("click", () => submitForReview().catch((error) => setMessage(error.message, "needs")));
    $("signOut").addEventListener("click", () => client.auth.signOut().catch((error) => setMessage(error.message, "needs")));
    $("verifyCertificateButton").addEventListener("click", verifyCertificate);
    client.auth.onAuthStateChange((_event, session) => { window.setTimeout(() => renderSession(session).catch((error) => setMessage(error.message, "needs")), 0); });
    const { data: { session } } = await client.auth.getSession();
    await renderSession(session);
  }

  boot().catch((error) => {
    console.error(error);
    setMessage("Secure record service could not start. Your local browser record remains available.", "needs");
  });
})();
