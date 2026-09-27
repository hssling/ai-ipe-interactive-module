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
  const sessionId = (window.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 120);
  const eventThrottle = new Map();
  let assessmentControlsAdded = false;
  let analyticsConsoleAdded = false;
  let adminConsoleAdded = false;
  let passwordRecoveryMode = /(?:^|[#&])type=recovery(?:&|$)/i.test(window.location.hash || "");

  function activityStatusFromChecks() {
    const checks = window.moduleChecks ? window.moduleChecks() : [];
    return {
      setup: Boolean(checks[0]?.done),
      pre_assessment: Boolean(checks[1]?.done),
      a1: Boolean(checks[2]?.done),
      a2: Boolean(checks[3]?.done),
      a3a: Boolean(checks[4]?.done),
      a3b: Boolean(checks[5]?.done),
      close: Boolean(checks[6]?.done),
      facilitator_confirmation: Boolean(checks[7]?.done),
    };
  }

  function completionPercent() {
    const checks = window.moduleChecks ? window.moduleChecks() : [];
    // Facilitator confirmation is a review decision, not learner evidence.
    // Keep learner completion at 100% when the seven required evidence blocks
    // are complete, then let completion_status represent approval separately.
    const learnerChecks = checks.slice(0, 7);
    return learnerChecks.length ? Math.round((learnerChecks.filter((item) => item.done).length / learnerChecks.length) * 100) : 0;
  }

  function assessmentScores() {
    const answers = window.AI_IPE_ANSWERS || [];
    let knowledgeAnswered = 0;
    let knowledgeScore = 0;
    answers.forEach((answer, index) => {
      const selected = document.querySelector(`input[name="q${index}"]:checked`)?.value;
      if (selected) knowledgeAnswered += 1;
      if (selected === answer) knowledgeScore += 1;
    });
    let confidenceAnswered = 0;
    let confidenceTotal = 0;
    for (let index = 0; index < 8; index += 1) {
      const selected = document.querySelector(`input[name="c${index}"]:checked`)?.value;
      if (selected) { confidenceAnswered += 1; confidenceTotal += Number(selected); }
    }
    return { knowledgeScore, knowledgeMax: answers.length, knowledgeAnswered, confidenceTotal, confidenceMax: 40, confidenceAnswered };
  }

  async function recordEvent(eventType, activityKey = null, metadata = {}) {
    if (!client || !activeUser) return;
    const throttleKey = `${eventType}:${activityKey || ""}`;
    const now = Date.now();
    if (now - (eventThrottle.get(throttleKey) || 0) < 15000) return;
    eventThrottle.set(throttleKey, now);
    const { error } = await client.from("ai_ipe_module_events").insert({
      user_id: activeUser.id,
      event_type: eventType,
      activity_key: activityKey,
      session_id: sessionId,
      metadata,
    });
    if (error) console.warn("Analytics event was not recorded", error.message);
  }

  function addAssessmentControls() {
    if (assessmentControlsAdded || !$("assessment")) return;
    assessmentControlsAdded = true;
    $("assessment").insertAdjacentHTML("afterbegin", `
      <div class="card accent no-print" id="assessmentRecordControls">
        <h3>Record an assessment attempt</h3>
        <p class="small">Capture the completed knowledge and confidence items as a baseline before learning and again after the module. Only the scores and timing are reported; individual answers are not included in course summaries.</p>
        <button type="button" class="secondary" id="capturePreAssessment">Record pre-assessment</button>
        <button type="button" id="capturePostAssessment">Record post-assessment</button>
        <span class="small" id="assessmentCaptureStatus" role="status"></span>
      </div>`);
  }

  async function captureAssessment(type) {
    if (!activeUser) throw new Error("Sign in before recording an assessment attempt.");
    const scores = assessmentScores();
    if (scores.knowledgeAnswered < scores.knowledgeMax || scores.confidenceAnswered < 8) {
      throw new Error("Answer all knowledge and confidence items before recording this assessment.");
    }
    const { error } = await client.from("ai_ipe_module_assessment_attempts").insert({
      user_id: activeUser.id,
      assessment_type: type,
      knowledge_score: scores.knowledgeScore,
      knowledge_max: scores.knowledgeMax,
      confidence_total: scores.confidenceTotal,
      confidence_max: scores.confidenceMax,
      summary: { knowledge_answered: scores.knowledgeAnswered, confidence_answered: scores.confidenceAnswered },
    });
    if (error) throw error;
    await recordEvent("assessment_captured", type === "pre" ? "pre_assessment" : "close", { assessment_type: type, knowledge_score: scores.knowledgeScore, confidence_total: scores.confidenceTotal });
    $("assessmentCaptureStatus").textContent = `${type === "pre" ? "Pre" : "Post"}-assessment recorded at ${new Date().toLocaleString()}.`;
    $("assessmentCaptureStatus").className = "small good";
  }

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
        <p class="small" id="accountMessage">Use your email and password to save an encrypted-in-transit record, submit it for review, and receive a registered certificate.</p>
        <p class="small">Browser-only entries stay on this device and are not encrypted at rest. Videos, external references and secure sign-in require an internet connection; use “Download learner record” to keep a backup and clear shared-device data when finished.</p>
        <div id="signedOutControls" class="grid g2">
          <div><label for="authName">Full name for your certificate</label><input id="authName" autocomplete="name" placeholder="Enter your name as it should appear"></div>
          <div><label for="authEmail">Email address</label><input id="authEmail" type="email" autocomplete="email" placeholder="you@example.org"></div>
          <div><label for="authPassword">Password</label><input id="authPassword" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters"></div>
          <div style="grid-column:1/-1"><button type="button" id="signInPassword">Sign in</button><button type="button" id="createPasswordAccount" class="secondary">Create account</button><button type="button" id="forgotPassword" class="outline">Forgot password?</button><p class="small">Use the same password on future visits. New accounts may require one email confirmation; password recovery uses a one-time email link.</p></div>
        </div>
        <div id="passwordRecoveryControls" class="card gold hidden" style="margin-top:1rem"><h4>Set a new password</h4><p class="small">Choose a new password for this module account, then continue with normal password sign-in.</p><div class="grid g2"><div><label for="newPassword">New password</label><input id="newPassword" type="password" autocomplete="new-password" minlength="8"></div><div><label for="confirmPassword">Confirm password</label><input id="confirmPassword" type="password" autocomplete="new-password" minlength="8"></div></div><button type="button" id="updatePassword">Save new password</button></div>
        <div id="signedInControls" class="hidden"><p><strong id="signedInName"></strong> <span id="signedInEmail" class="small"></span></p><button type="button" id="saveCloudRecord" class="secondary">Save secure record</button><button type="button" id="requestReview" class="warm">Submit for facilitator review</button><button type="button" id="signOut" class="outline">Sign out</button><p id="reviewStatus" class="small"></p></div>
      </div><div id="privilegedConsoleMount"></div>`);

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
    const now = new Date().toISOString();
    const startedKey = `${recordKey}-started-at`;
    const startedAt = localStorage.getItem(startedKey) || now;
    localStorage.setItem(startedKey, startedAt);
    record.version = "November 2026 AI IPE interactive module — secure record";
    record.savedAt = now;
    record.startedAt = startedAt;
    record.lastActivityAt = now;
    record.completion = (window.moduleChecks ? window.moduleChecks() : []).map(({ label, done }) => ({ label, done }));
    record.activityStatus = activityStatusFromChecks();
    record.completionPercent = completionPercent();
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
    let { data, error } = await client
      .from("ai_ipe_module_progress")
      .select("user_id, learner_name, learner_record, completion_status, submitted_at, review_note, reviewed_at, updated_at, started_at, last_activity_at, last_saved_at, completion_percent, activity_status")
      .eq("user_id", activeUser.id)
      .maybeSingle();
    if (error && /column|schema cache|does not exist/i.test(error.message || "")) {
      const fallback = await client.from("ai_ipe_module_progress")
        .select("user_id, learner_name, learner_record, completion_status, submitted_at, review_note, reviewed_at, updated_at")
        .eq("user_id", activeUser.id)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;
    }
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
    let { error } = await client.from("ai_ipe_module_progress").upsert({
      user_id: activeUser.id,
      learner_name: name,
      learner_record: payload,
      started_at: payload.startedAt,
      last_activity_at: payload.lastActivityAt,
      last_saved_at: payload.savedAt,
      completion_percent: payload.completionPercent,
      activity_status: payload.activityStatus,
    }, { onConflict: "user_id" });
    if (error && /column|schema cache|does not exist/i.test(error.message || "")) {
      const fallback = await client.from("ai_ipe_module_progress").upsert({
        user_id: activeUser.id,
        learner_name: name,
        learner_record: payload,
      }, { onConflict: "user_id" });
      error = fallback.error;
      if (!error && !quiet) setMessage("Record saved. Analytics fields will activate after the module database migration is applied.", "needs");
    }
    if (error) throw error;
    localStorage.setItem(recordKey, JSON.stringify(payload));
    const previousStatus = remoteProgress?.activity_status || {};
    Object.entries(payload.activityStatus || {}).forEach(([activityKey, done]) => {
      if (done && !previousStatus[activityKey]) recordEvent("activity_completed", activityKey, { completion_percent: payload.completionPercent });
    });
    recordEvent("record_saved", null, { completion_percent: payload.completionPercent });
    remoteProgress = { ...(remoteProgress || {}), user_id: activeUser.id, learner_name: name, learner_record: payload, completion_percent: payload.completionPercent, activity_status: payload.activityStatus, last_activity_at: payload.lastActivityAt, last_saved_at: payload.savedAt };
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
    let { error } = await client.from("ai_ipe_module_progress")
      .update({ completion_status: "submitted", submitted_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
      .eq("user_id", activeUser.id);
    if (error && /column|schema cache|does not exist/i.test(error.message || "")) {
      const fallback = await client.from("ai_ipe_module_progress")
        .update({ completion_status: "submitted", submitted_at: new Date().toISOString() })
        .eq("user_id", activeUser.id);
      error = fallback.error;
    }
    if (error) throw error;
    await recordEvent("module_submitted", "module", { completion_percent: completionPercent() });
    await loadRemoteRecord();
    setMessage("Your record has been submitted for facilitator review.", "good");
  }

  function validatePassword(password) {
    if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
  }

  async function signInWithPassword() {
    const email = String($("authEmail").value || "").trim();
    const password = String($("authPassword").value || "");
    if (!email || !password) throw new Error("Enter your email address and password.");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      if (/invalid login credentials/i.test(error.message || "")) throw new Error("Invalid email or password. If this account previously used a sign-in link, choose Forgot password? once to set a password.");
      throw error;
    }
    setMessage("Signed in. Your secure learner record is now connected.", "good");
  }

  async function createPasswordAccount() {
    const email = String($("authEmail").value || "").trim();
    const name = String($("authName").value || "").trim();
    const password = String($("authPassword").value || "");
    if (!name || !email || !password) throw new Error("Enter your full name, email address and password.");
    validatePassword(password);
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { display_name: name, requested_role: "student" }, emailRedirectTo: window.location.href.split("#")[0] },
    });
    if (error) throw error;
    if (data.session) setMessage("Account created and signed in. Your secure learner record is ready.", "good");
    else setMessage("Account created. Check your email once to confirm the account, then sign in with your password.", "good");
  }

  async function requestPasswordReset() {
    const email = String($("authEmail").value || "").trim();
    if (!email) throw new Error("Enter your email address first.");
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split("#")[0] });
    if (error) throw error;
    setMessage("If that account exists, a password-reset email has been sent. Use it once, then return here to sign in with your new password.", "good");
  }

  async function updatePassword() {
    const password = String($("newPassword").value || "");
    const confirmation = String($("confirmPassword").value || "");
    validatePassword(password);
    if (password !== confirmation) throw new Error("The new passwords do not match.");
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    passwordRecoveryMode = false;
    $("passwordRecoveryControls").classList.add("hidden");
    $("newPassword").value = "";
    $("confirmPassword").value = "";
    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    setMessage("Password updated. You can now sign in with your email and password.", "good");
  }

  async function renderSession(session) {
    activeUser = session?.user || null;
    $("signedOutControls").classList.toggle("hidden", Boolean(activeUser));
    $("signedInControls").classList.toggle("hidden", !activeUser);
    if (!activeUser) {
      remoteProgress = null;
      officialCertificate = null;
      $("passwordRecoveryControls").classList.add("hidden");
      setMessage(projectReady ? "Sign in with your email and password to save and submit an official completion record." : "Secure record service is being configured. Local browser saving remains available.");
      return;
    }
    const displayName = activeUser.user_metadata?.display_name || activeUser.email?.split("@")[0] || "Signed-in learner";
    $("signedInName").textContent = displayName;
    $("signedInEmail").textContent = activeUser.email ? `(${activeUser.email})` : "";
    if (!$("certNameInput").value) $("certNameInput").value = displayName;
    $("passwordRecoveryControls").classList.toggle("hidden", !passwordRecoveryMode);
    await loadRemoteRecord();
    if (remoteProgress?.completion_status !== "approved") {
      await saveSecureRecord({ quiet: true });
    }
    setMessage("Your account is connected. Learning evidence is saved securely when you edit.", "good");
    await recordEvent("session_started", null, { user_agent: navigator.userAgent.slice(0, 120) });
    await maybeShowReviewerConsole();
  }

  function addAnalyticsEventListeners() {
    document.addEventListener("click", (event) => {
      const anchor = event.target.closest?.("a[href]");
      if (anchor) {
        const href = anchor.getAttribute("href") || "";
        const section = href.match(/^#(a1|a2|a3a|a3b|assessment|close)$/)?.[1];
        if (section) recordEvent("activity_started", section, {});
        if (/youtube\.com|youtu\.be/i.test(href)) {
          let videoId = "external";
          try { const url = new URL(href, window.location.href); videoId = url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop() || videoId; } catch (_) { /* safe fallback */ }
          recordEvent("video_opened", "video_library", { video_id: videoId });
        } else if (/^https?:\/\//i.test(href) && !href.includes(window.location.host)) {
          try { recordEvent("resource_opened", "resources", { host: new URL(href).host }); } catch (_) { /* safe fallback */ }
        }
      }
      if (event.target.closest?.("#lsNext, #lsPrev, #lsSelect, #lsDots")) {
        const slide = document.getElementById("lsSelect")?.value;
        recordEvent("slide_progressed", "learning_slideshow", { slide: slide ? Number(slide) + 1 : null });
      }
      if (event.target.closest?.("#downloadCertificateButton")) recordEvent("certificate_downloaded", "certificate", {});
    }, { passive: true });
  }

  function reportMetric(label, value, detail = "") {
    return `<div class="card accent"><div class="small">${escapeHtml(label)}</div><strong style="font-size:1.55rem;color:var(--navy)">${escapeHtml(value)}</strong>${detail ? `<div class="small">${escapeHtml(detail)}</div>` : ""}</div>`;
  }

  function formatReportNumber(value, digits = 1) {
    return value === null || value === undefined ? "—" : Number(value).toFixed(digits);
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function downloadAnalyticsFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function downloadAnalyticsCsv() {
    const rows = window.__aiIpeAnalyticsRows || [];
    const columns = ["learner_name", "profession", "group_id", "completion_status", "completion_percent", "active_days", "session_count", "event_count", "activities_completed", "activities_on_time", "pre_knowledge_score", "post_knowledge_score", "knowledge_gain", "pre_confidence_mean", "post_confidence_mean", "confidence_gain", "feedback_mean", "submitted_at", "submission_timeliness", "last_activity_at"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
    downloadAnalyticsFile(`AI_IPE_course_learner_report_${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  }

  function downloadAnalyticsJson() {
    const payload = { generatedAt: new Date().toISOString(), summary: window.__aiIpeAnalyticsSummary || null, learners: window.__aiIpeAnalyticsRows || [] };
    downloadAnalyticsFile(`AI_IPE_course_report_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json");
  }

  async function refreshAnalytics() {
    const status = $("analyticsStatus");
    if (!status) return;
    status.textContent = "Loading course report…";
    const [{ data: summary, error: summaryError }, { data: rows, error: rowsError }] = await Promise.all([
      client.from("ai_ipe_course_report").select("*").maybeSingle(),
      client.from("ai_ipe_module_reporting").select("*").order("completion_percent", { ascending: false }).order("last_activity_at", { ascending: false, nullsFirst: false }),
    ]);
    if (summaryError || rowsError) {
      status.textContent = `Course report could not load: ${(summaryError || rowsError).message}`;
      status.className = "small needs";
      return;
    }
    window.__aiIpeAnalyticsSummary = summary || {};
    window.__aiIpeAnalyticsRows = rows || [];
    const s = summary || {};
    $("analyticsSummary").innerHTML = [
      reportMetric("Registered learners", s.registered_learners ?? 0),
      reportMetric("Engaged learners", s.started_learners ?? 0, `${formatReportNumber(s.engagement_rate_percent)}% of registered`),
      reportMetric("Submitted / approved", `${s.submitted_learners ?? 0} / ${s.approved_learners ?? 0}`, `${formatReportNumber(s.approval_rate_percent)}% approved`),
      reportMetric("On-time submissions", s.on_time_submissions ?? 0, `${formatReportNumber(s.on_time_rate_percent)}% of submitted`),
      reportMetric("Knowledge gain", formatReportNumber(s.mean_knowledge_gain), `${formatReportNumber(s.mean_pre_knowledge)} → ${formatReportNumber(s.mean_post_knowledge)}`),
      reportMetric("Confidence gain", formatReportNumber(s.mean_confidence_gain), `${formatReportNumber(s.mean_pre_confidence)} → ${formatReportNumber(s.mean_post_confidence)} / 5`),
      reportMetric("Mean active days", formatReportNumber(s.mean_active_days), `${formatReportNumber(s.mean_sessions)} sessions`),
      reportMetric("Mean learner feedback", formatReportNumber(s.mean_feedback), "1–5 scale"),
    ].join("");
    const rowsArea = $("analyticsRows");
    if (!rows?.length) rowsArea.innerHTML = `<p class="small">No learner accounts have been registered yet.</p>`;
    else rowsArea.innerHTML = `<div style="overflow-x:auto"><table class="rubric"><thead><tr><th>Learner</th><th>Status</th><th>Complete</th><th>Active days</th><th>Activities on time</th><th>Knowledge</th><th>Confidence</th><th>Submission</th><th>Last active</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.learner_name)}<br><span class="small">${escapeHtml(row.profession || row.group_id || "")}</span></td><td>${escapeHtml(row.completion_status)}</td><td>${escapeHtml(row.completion_percent)}%</td><td>${escapeHtml(row.active_days ?? 0)}</td><td>${escapeHtml(row.activities_on_time ?? 0)} / ${escapeHtml(row.activities_completed ?? 0)}</td><td>${escapeHtml(row.pre_knowledge_score ?? "—")} → ${escapeHtml(row.post_knowledge_score ?? "—")}</td><td>${escapeHtml(formatReportNumber(row.pre_confidence_mean))} → ${escapeHtml(formatReportNumber(row.post_confidence_mean))}</td><td>${escapeHtml(row.submission_timeliness)}</td><td>${escapeHtml(row.last_activity_at ? new Date(row.last_activity_at).toLocaleString() : "—")}</td></tr>`).join("")}</tbody></table></div>`;
    status.textContent = `Report generated ${new Date(s.generated_at || Date.now()).toLocaleString()}. Download the CSV or JSON for the end-of-course summary.`;
    status.className = "small good";
  }

  async function currentUserIsAdmin() {
    const { data, error } = await client.from("module_profiles").select("role").eq("user_id", activeUser.id).maybeSingle();
    return !error && data?.role === "admin";
  }

  async function refreshFacilitatorAdminPanel() {
    const status = $("facilitatorAdminStatus");
    const rowsArea = $("facilitatorAdminRows");
    const select = $("facilitatorCandidate");
    if (!status || !rowsArea || !select) return;
    status.textContent = "Loading module users…";
    const [{ data: users, error: usersError }, { data: assignments, error: assignmentsError }] = await Promise.all([
      client.from("module_profiles").select("user_id, display_name, role, created_at").order("display_name"),
      client.from("ai_ipe_module_facilitators").select("user_id, assigned_at, assigned_by").order("assigned_at"),
    ]);
    if (usersError || assignmentsError) {
      status.textContent = `Facilitator list could not load: ${(usersError || assignmentsError).message}`;
      status.className = "small needs";
      return;
    }
    const assignmentMap = new Map((assignments || []).map((item) => [item.user_id, item]));
    const candidates = (users || []).filter((user) => user.role !== "admin");
    select.innerHTML = candidates.length
      ? candidates.map((user) => `<option value="${escapeHtml(user.user_id)}">${escapeHtml(user.display_name)}${assignmentMap.has(user.user_id) ? " · already assigned" : ""}</option>`).join("")
      : `<option value="">No learner accounts registered yet</option>`;
    select.disabled = !candidates.length;
    $("assignFacilitator").disabled = !candidates.length;
    rowsArea.innerHTML = assignments?.length
      ? assignments.map((assignment) => {
        const user = (users || []).find((candidate) => candidate.user_id === assignment.user_id);
        return `<article class="card accent"><strong>${escapeHtml(user?.display_name || assignment.user_id)}</strong><span class="small"> Assigned ${escapeHtml(new Date(assignment.assigned_at).toLocaleString())}</span><button type="button" class="outline" data-facilitator-action="remove" data-user="${escapeHtml(assignment.user_id)}">Remove facilitator access</button></article>`;
      }).join("")
      : `<p class="small">No facilitators are assigned yet.</p>`;
    status.textContent = `${candidates.length} non-admin module account${candidates.length === 1 ? "" : "s"} available. Assign only trusted reviewers.`;
    status.className = "small good";
  }

  async function assignFacilitator() {
    const userId = $("facilitatorCandidate")?.value;
    if (!userId) return;
    const { error } = await client.from("ai_ipe_module_facilitators").upsert({ user_id: userId, assigned_by: activeUser.id }, { onConflict: "user_id" });
    if (error) throw error;
    await refreshFacilitatorAdminPanel();
  }

  async function removeFacilitator(userId) {
    if (!window.confirm("Remove facilitator review access for this account?")) return;
    const { error } = await client.from("ai_ipe_module_facilitators").delete().eq("user_id", userId);
    if (error) throw error;
    await refreshFacilitatorAdminPanel();
  }

  async function maybeShowAdminConsole(isAdmin = null) {
    if (adminConsoleAdded || !(isAdmin ?? await currentUserIsAdmin())) return;
    adminConsoleAdded = true;
    $("privilegedConsoleMount").insertAdjacentHTML("beforeend", `
      <section id="facilitatorAdminConsole" class="no-print"><h2>Module administration</h2>
      <p class="lead">Assign or remove facilitator review access for accounts in this standalone AI/IPE database. This panel does not affect Learning Compass.</p>
      <div class="grid g2"><div><label for="facilitatorCandidate">Module account</label><select id="facilitatorCandidate"></select><button type="button" id="assignFacilitator">Assign facilitator</button><button type="button" id="refreshFacilitators" class="outline">Refresh users</button></div><div><p id="facilitatorAdminStatus" class="small" role="status"></p><div id="facilitatorAdminRows" class="grid"></div></div></div></section>`);
    $("assignFacilitator").addEventListener("click", () => assignFacilitator().catch((error) => { $("facilitatorAdminStatus").textContent = `Assignment failed: ${error.message}`; $("facilitatorAdminStatus").className = "small needs"; }));
    $("refreshFacilitators").addEventListener("click", () => refreshFacilitatorAdminPanel());
    $("facilitatorAdminRows").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-facilitator-action=remove]");
      if (button) removeFacilitator(button.dataset.user).catch((error) => { $("facilitatorAdminStatus").textContent = `Removal failed: ${error.message}`; $("facilitatorAdminStatus").className = "small needs"; });
    });
    await refreshFacilitatorAdminPanel();
  }

  async function maybeShowReviewerConsole() {
    const isAdmin = await currentUserIsAdmin();
    const { data, error } = await client.rpc("is_ai_ipe_module_reviewer");
    if (!isAdmin && (error || !data)) return;
    await maybeShowAdminConsole(isAdmin);
    if ($("reviewerConsole")) return;
    $("privilegedConsoleMount").insertAdjacentHTML("beforeend", `
      <section id="reviewerConsole" class="no-print"><h2>Facilitator review console</h2>
      <p class="lead">Review submitted learner records, request a specific revision, or issue a registered certificate. Approval does not alter the learner's evidence.</p>
      <button type="button" id="refreshReviews" class="secondary">Refresh submitted records</button>
      <div id="reviewRows" class="grid" style="margin-top:1rem"></div></section>`);
    $("refreshReviews").addEventListener("click", () => refreshReviews());
    $("reviewRows").addEventListener("click", reviewAction);
    try {
      await refreshReviews();
    } catch (refreshError) {
      $("reviewRows").textContent = `Review records could not load: ${refreshError.message}`;
    }
    if (!analyticsConsoleAdded) {
      analyticsConsoleAdded = true;
      $("privilegedConsoleMount").insertAdjacentHTML("beforeend", `
        <section id="analyticsConsole" class="no-print"><h2>Course analytics and report</h2>
        <p class="lead">This report summarises authenticated learner activity, assessment change, completion, feedback and timeliness. It does not expose individual assessment answers.</p>
        <div id="analyticsSummary" class="grid g3"></div>
        <div class="footer-actions"><button type="button" id="refreshAnalytics" class="secondary">Refresh course report</button><button type="button" id="downloadAnalyticsCsv" class="outline">Download learner CSV</button><button type="button" id="downloadAnalyticsJson" class="outline">Download report JSON</button></div>
        <p id="analyticsStatus" class="small" role="status"></p><div id="analyticsRows"></div></section>`);
      $("refreshAnalytics").addEventListener("click", () => refreshAnalytics());
      $("downloadAnalyticsCsv").addEventListener("click", downloadAnalyticsCsv);
      $("downloadAnalyticsJson").addEventListener("click", downloadAnalyticsJson);
      try {
        await refreshAnalytics();
      } catch (refreshError) {
        $("analyticsStatus").textContent = `Course report could not load: ${refreshError.message}`;
        $("analyticsStatus").className = "small needs";
      }
    }
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
    addAssessmentControls();
    addAnalyticsEventListeners();
    addOnlineInterface();
    overrideCertificateGate();
    ["certIdInput", "certDateInput", "verifierInput", "certVerify", "confirmReviewed"].forEach((id) => { $(id).disabled = true; });
    const confirmLabel = $("confirmReviewed")?.closest("label");
    if (confirmLabel) confirmLabel.append(" Facilitator confirmation is recorded securely after review.");
    document.addEventListener("input", queueSecureSave);
    document.addEventListener("change", queueSecureSave);

    if (!projectReady) {
      $("signInPassword").disabled = true;
      $("createPasswordAccount").disabled = true;
      $("forgotPassword").disabled = true;
      $("verifyCertificateButton").disabled = true;
      setMessage("Secure record service is being configured. Local browser saving remains available.", "needs");
      return;
    }
    client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
    $("capturePreAssessment").addEventListener("click", () => captureAssessment("pre").catch((error) => { $("assessmentCaptureStatus").textContent = error.message; $("assessmentCaptureStatus").className = "small needs"; }));
    $("capturePostAssessment").addEventListener("click", () => captureAssessment("post").catch((error) => { $("assessmentCaptureStatus").textContent = error.message; $("assessmentCaptureStatus").className = "small needs"; }));
    $("signInPassword").addEventListener("click", () => signInWithPassword().catch((error) => setMessage(error.message, "needs")));
    $("createPasswordAccount").addEventListener("click", () => createPasswordAccount().catch((error) => setMessage(error.message, "needs")));
    $("forgotPassword").addEventListener("click", () => requestPasswordReset().catch((error) => setMessage(error.message, "needs")));
    $("updatePassword").addEventListener("click", () => updatePassword().catch((error) => setMessage(error.message, "needs")));
    $("saveCloudRecord").addEventListener("click", () => saveSecureRecord().catch((error) => setMessage(error.message, "needs")));
    $("requestReview").addEventListener("click", () => submitForReview().catch((error) => setMessage(error.message, "needs")));
    $("signOut").addEventListener("click", () => client.auth.signOut().catch((error) => setMessage(error.message, "needs")));
    $("verifyCertificateButton").addEventListener("click", verifyCertificate);
    client.auth.onAuthStateChange((event, session) => { if (event === "PASSWORD_RECOVERY") passwordRecoveryMode = true; window.setTimeout(() => renderSession(session).catch((error) => setMessage(error.message, "needs")), 0); });
    const { data: { session } } = await client.auth.getSession();
    await renderSession(session);
  }

  boot().catch((error) => {
    console.error(error);
    setMessage("Secure record service could not start. Your local browser record remains available.", "needs");
  });
})();
