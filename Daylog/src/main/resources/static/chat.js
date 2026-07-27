// [B] edit by smsong - 방 채팅 (카카오톡 스타일 · 실시간 raw WebSocket). main.html 전용.
//  · 상단 채팅 버튼(#btn-chat) → 우측 슬라이드 패널로 현재 방 채팅 오픈
//  · 방(selectedRoomId) 멤버 전원이 대화. 발신자 프로필/이름 표시.
//  · 카카오톡처럼 각 메시지 옆에 '안 읽은 사람 수' 표시(모두 읽으면 사라짐).
//    → '읽은 수'로 바꾸려면 아래 COUNT_MODE 를 'read' 로만 바꾸면 됨(서버 변경 불필요).
(function () {
    'use strict';

    var API = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_BASE) || '';
    var COUNT_MODE = 'unread'; // 'unread'(카톡 기본) | 'read'

    // ===== 공통 유틸 =====
    function token() { return localStorage.getItem('accessToken'); }
    function loggedIn() { return !!token(); }
    function roomId() { return localStorage.getItem('selectedRoomId') || ''; }
    function myUid() { return (window.Daylog && window.Daylog.currentUid) || localStorage.getItem('uid') || ''; }
    function authHeaders(json) {
        var h = {};
        var t = token();
        if (t) h['Authorization'] = 'Bearer ' + t;
        if (json) h['Content-Type'] = 'application/json';
        return h;
    }
    function esc(s) {
        return (s == null ? '' : String(s))
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function toast(msg) {
        if (typeof window.showToast === 'function') { window.showToast(msg); return; }
        var t = document.getElementById('toast');
        if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 1800); }
    }
    function clock(iso) {
        if (!iso) return '';
        var d = new Date(iso); if (isNaN(d.getTime())) return '';
        var h = d.getHours(), m = d.getMinutes();
        var ap = h < 12 ? '오전' : '오후';
        var hh = h % 12; if (hh === 0) hh = 12;
        return ap + ' ' + hh + ':' + (m < 10 ? '0' + m : m);
    }
    function dayLabel(iso) {
        var d = new Date(iso); if (isNaN(d.getTime())) return '';
        var days = ['일', '월', '화', '수', '목', '금', '토'];
        return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + days[d.getDay()] + '요일';
    }
    function dayKey(iso) { var d = new Date(iso); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }

    // ===== 상태 =====
    var state = {
        me: '', members: [], reads: {}, memberCount: 0,
        msgs: [],           // 오름차순 메시지 배열
        hasMore: false, loadingMore: false, oldestId: null,
        open: false, unread: 0
    };
    var ws = null, wsTimer = null, wsBackoff = 1000, subscribed = false;

    // ===== WebSocket =====
    function wsUrl() {
        var httpBase;
        if (!API) httpBase = location.origin;
        else if (/^https?:\/\//i.test(API)) httpBase = API;
        else httpBase = location.origin;
        var base = httpBase.replace(/^http/i, 'ws'); // http→ws, https→wss
        return base + '/ws/chat?token=' + encodeURIComponent(token() || '');
    }
    function wsConnect() {
        if (!loggedIn() || !roomId()) return;
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
        try { ws = new WebSocket(wsUrl()); } catch (e) { scheduleReconnect(); return; }

        ws.onopen = function () {
            wsBackoff = 1000;
            subscribed = false;
            wsSend({ type: 'sub', roomId: Number(roomId()) });
            subscribed = true;
        };
        ws.onmessage = function (ev) {
            var data; try { data = JSON.parse(ev.data); } catch (e) { return; }
            if (data.type === 'msg') onIncomingMsg(data.message);
            else if (data.type === 'read') onIncomingRead(data);
        };
        ws.onclose = function () { subscribed = false; scheduleReconnect(); };
        ws.onerror = function () { try { ws.close(); } catch (e) {} };
    }
    function scheduleReconnect() {
        if (wsTimer) return;
        wsTimer = setTimeout(function () {
            wsTimer = null;
            wsBackoff = Math.min(wsBackoff * 1.6, 15000);
            wsConnect();
        }, wsBackoff);
    }
    function wsSend(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(obj)); return true; } catch (e) {} }
        return false;
    }

    // ===== 안 읽은/읽은 수 계산 =====
    function countFor(m) {
        if (!m || m.type === 'SYSTEM' || !m.id) return 0;
        var others = state.members.filter(function (u) { return u !== m.senderUid; });
        if (!others.length) return 0;
        var readN = 0;
        for (var i = 0; i < others.length; i++) {
            if ((state.reads[others[i]] || 0) >= m.id) readN++;
        }
        var unreadN = others.length - readN;
        return COUNT_MODE === 'read' ? readN : unreadN;
    }

    // ===== 렌더 =====
    function avatarHtml(m) {
        if (m.senderProfileURL) {
            return '<img class="dchat-ava" src="' + esc(m.senderProfileURL) + '" alt="">';
        }
        var initial = (m.senderName || '?').trim().charAt(0) || '?';
        return '<span class="dchat-ava dchat-ava-ph">' + esc(initial) + '</span>';
    }
    function countTag(m) {
        var n = countFor(m);
        if (n <= 0) return '';
        return '<span class="dchat-unread">' + n + '</span>';
    }
    function messageRowHtml(m, showHead) {
        if (m.type === 'SYSTEM') {
            return '<div class="dchat-sys">' + esc(m.content) + '</div>';
        }
        var time = '<span class="dchat-time">' + clock(m.createdAt) + '</span>';
        var cnt = countTag(m);
        var bubble = '<div class="dchat-bubble">' + esc(m.content).replace(/\n/g, '<br>') + '</div>';
        if (m.mine) {
            // 내 메시지: 오른쪽. 메타(안읽음수 + 시간)는 버블 왼쪽.
            return '<div class="dchat-row mine" data-id="' + m.id + '">' +
                '<div class="dchat-meta">' + cnt + time + '</div>' +
                bubble +
                '</div>';
        }
        // 상대 메시지: 카톡식. 아바타(왼쪽) + [닉네임 → 버블] 세로 배치. 연속이면 아바타/닉네임 생략.
        var avatar = showHead ? avatarHtml(m) : '<span class="dchat-ava-spacer"></span>';
        var nameLine = showHead ? '<div class="dchat-name">' + esc(m.senderName || '알 수 없음') + '</div>' : '';
        return '<div class="dchat-row other' + (showHead ? ' head' : '') + '" data-id="' + m.id + '">' +
            '<div class="dchat-avacol">' + avatar + '</div>' +
            '<div class="dchat-othercol">' +
                nameLine +
                '<div class="dchat-line">' +
                    bubble +
                    '<div class="dchat-meta">' + time + cnt + '</div>' +
                '</div>' +
            '</div>' +
            '</div>';
    }

    function renderAll() {
        var scroll = document.getElementById('dchat-scroll');
        if (!scroll) return;
        var html = '';
        var prevDay = null, prevSender = null;
        for (var i = 0; i < state.msgs.length; i++) {
            var m = state.msgs[i];
            var dk = dayKey(m.createdAt);
            if (dk !== prevDay) {
                html += '<div class="dchat-daysep"><span>' + esc(dayLabel(m.createdAt)) + '</span></div>';
                prevDay = dk; prevSender = null;
            }
            var showHead = (m.type !== 'SYSTEM') && !m.mine && (m.senderUid !== prevSender);
            html += messageRowHtml(m, showHead);
            prevSender = (m.type === 'SYSTEM') ? null : m.senderUid;
        }
        scroll.innerHTML = html || '<div class="dchat-empty">첫 메시지를 남겨보세요 ✍️</div>';
    }

    // 안 읽은 수만 다시 그림(읽음 이벤트 수신 시): 각 .dchat-row 의 카운트 갱신
    function refreshCounts() {
        var scroll = document.getElementById('dchat-scroll');
        if (!scroll) return;
        var byId = {};
        state.msgs.forEach(function (m) { byId[m.id] = m; });
        scroll.querySelectorAll('.dchat-row').forEach(function (row) {
            var id = Number(row.getAttribute('data-id'));
            var m = byId[id]; if (!m) return;
            var n = countFor(m);
            var tag = row.querySelector('.dchat-unread');
            if (n > 0) {
                if (tag) tag.textContent = n;
                else {
                    var meta = row.querySelector('.dchat-meta');
                    if (meta) {
                        var span = document.createElement('span');
                        span.className = 'dchat-unread';
                        span.textContent = n;
                        if (row.classList.contains('mine')) meta.insertBefore(span, meta.firstChild);
                        else meta.appendChild(span);
                    }
                }
            } else if (tag) {
                tag.parentNode.removeChild(tag);
            }
        });
    }

    function scrollToBottom(smooth) {
        var scroll = document.getElementById('dchat-scroll');
        if (!scroll) return;
        scroll.scrollTo({ top: scroll.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }
    function nearBottom() {
        var scroll = document.getElementById('dchat-scroll');
        if (!scroll) return true;
        return (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight) < 80;
    }

    // ===== 수신 처리 =====
    function onIncomingMsg(m) {
        if (!m || Number(m.roomId) !== Number(roomId())) return;
        m.mine = (m.senderUid === state.me) || (m.senderUid === myUid());
        // 발신자를 읽음으로 반영(서버도 그렇게 처리)
        if (m.senderUid) state.reads[m.senderUid] = Math.max(state.reads[m.senderUid] || 0, m.id);
        state.msgs.push(m);

        if (state.open) {
            var atBottom = nearBottom();
            appendMessageDom(m);
            if (m.mine || atBottom) scrollToBottom(true);
            // 상대 메시지를 봤으니 읽음 전송
            if (!m.mine) markReadUpTo(m.id);
            refreshCounts();
        } else {
            if (!m.mine) { state.unread++; setBadge(state.unread); }
        }
    }
    function appendMessageDom(m) {
        var scroll = document.getElementById('dchat-scroll');
        if (!scroll) return;
        var empty = scroll.querySelector('.dchat-empty');
        if (empty) empty.parentNode.removeChild(empty);
        // 직전 메시지 기준 헤더/날짜 구분 판단
        var last = null;
        for (var i = state.msgs.length - 2; i >= 0; i--) { last = state.msgs[i]; break; }
        var needDay = !last || dayKey(last.createdAt) !== dayKey(m.createdAt);
        if (needDay) {
            var sep = document.createElement('div');
            sep.className = 'dchat-daysep';
            sep.innerHTML = '<span>' + esc(dayLabel(m.createdAt)) + '</span>';
            scroll.appendChild(sep);
        }
        var showHead = (m.type !== 'SYSTEM') && !m.mine && (needDay || !last || last.senderUid !== m.senderUid || last.type === 'SYSTEM');
        var wrap = document.createElement('div');
        wrap.innerHTML = messageRowHtml(m, showHead);
        while (wrap.firstChild) scroll.appendChild(wrap.firstChild);
    }
    function onIncomingRead(d) {
        if (!d || Number(d.roomId) !== Number(roomId())) return;
        state.reads[d.uid] = Math.max(state.reads[d.uid] || 0, d.lastId);
        if (state.open) refreshCounts();
    }

    // ===== 읽음 전송 =====
    function markReadUpTo(id) {
        if (!id) return;
        state.reads[state.me] = Math.max(state.reads[state.me] || 0, id);
        if (!wsSend({ type: 'read', roomId: Number(roomId()), lastId: id })) {
            // 소켓 끊김 → REST 폴백
            fetch(API + '/api/chat/' + roomId() + '/read?lastId=' + id, { method: 'POST', headers: authHeaders() }).catch(function () {});
        }
    }

    // ===== 히스토리 로딩 =====
    function loadHistory() {
        var scroll = document.getElementById('dchat-scroll');
        if (scroll) scroll.innerHTML = '<div class="dchat-empty">불러오는 중…</div>';
        return fetch(API + '/api/chat/' + roomId(), { headers: authHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (h) {
                if (!h) { if (scroll) scroll.innerHTML = '<div class="dchat-empty">불러오지 못했어요</div>'; return; }
                state.me = h.me || myUid();
                state.members = h.memberUids || [];
                state.memberCount = h.memberCount || state.members.length;
                state.reads = h.reads || {};
                state.msgs = (h.messages || []).map(function (m) {
                    m.mine = (m.senderUid === state.me);
                    return m;
                });
                state.hasMore = !!h.hasMore;
                state.oldestId = state.msgs.length ? state.msgs[0].id : null;
                updateHeadCount();
                renderAll();
                scrollToBottom(false);
                var last = state.msgs.length ? state.msgs[state.msgs.length - 1].id : 0;
                if (last) markReadUpTo(last);
                state.unread = 0; setBadge(0);
            })
            .catch(function () { if (scroll) scroll.innerHTML = '<div class="dchat-empty">불러오지 못했어요</div>'; });
    }
    function loadMore() {
        if (state.loadingMore || !state.hasMore || !state.oldestId) return;
        state.loadingMore = true;
        var scroll = document.getElementById('dchat-scroll');
        var prevH = scroll ? scroll.scrollHeight : 0;
        fetch(API + '/api/chat/' + roomId() + '?beforeId=' + state.oldestId, { headers: authHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (h) {
                if (h && h.messages && h.messages.length) {
                    var older = h.messages.map(function (m) { m.mine = (m.senderUid === state.me); return m; });
                    state.msgs = older.concat(state.msgs);
                    state.oldestId = state.msgs[0].id;
                    state.hasMore = !!h.hasMore;
                    if (h.reads) Object.keys(h.reads).forEach(function (k) { state.reads[k] = Math.max(state.reads[k] || 0, h.reads[k]); });
                    renderAll();
                    // 스크롤 위치 보존
                    if (scroll) scroll.scrollTop = scroll.scrollHeight - prevH;
                } else {
                    state.hasMore = false;
                }
            })
            .finally(function () { state.loadingMore = false; });
    }

    function updateHeadCount() {
        var el = document.getElementById('dchat-membercount');
        if (el) el.textContent = state.memberCount ? String(state.memberCount) : '';
    }

    // ===== 배지 =====
    function setBadge(n) {
        var b = document.getElementById('chat-badge');
        if (!b) return;
        if (n && n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.classList.remove('hidden'); }
        else { b.classList.add('hidden'); }
    }
    function refreshBadge() {
        if (!loggedIn() || !roomId()) { setBadge(0); return; }
        fetch(API + '/api/chat/' + roomId() + '/unread-count', { headers: authHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d) { state.unread = d.count || 0; if (!state.open) setBadge(state.unread); } })
            .catch(function () {});
    }

    // ===== 패널 열기/닫기 =====
    function closePanel() {
        state.open = false;
        var ov = document.getElementById('dchat-overlay');
        var pn = document.getElementById('dchat-panel');
        if (pn) pn.classList.remove('show');
        if (ov) ov.classList.remove('show');
        setTimeout(function () {
            if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
            if (pn && pn.parentNode) pn.parentNode.removeChild(pn);
        }, 240);
        refreshBadge();
    }

    function openPanel() {
        if (!loggedIn()) { toast('로그인이 필요해요'); return; }
        if (!roomId()) { toast('먼저 방을 선택해주세요'); return; }
        injectStyle();
        // 이미 열려있으면 무시
        if (document.getElementById('dchat-panel')) return;

        var ov = document.createElement('div');
        ov.id = 'dchat-overlay';
        var pn = document.createElement('div');
        pn.id = 'dchat-panel';
        pn.innerHTML =
            '<div class="dchat-head">' +
                '<div class="dchat-head-title">채팅 <span id="dchat-membercount" class="dchat-mc"></span></div>' +
                '<button class="dchat-close" type="button" aria-label="닫기">&times;</button>' +
            '</div>' +
            '<div id="dchat-scroll" class="dchat-scroll"></div>' +
            '<div class="dchat-inputbar">' +
                '<textarea id="dchat-input" rows="1" placeholder="메시지 입력" maxlength="2000"></textarea>' +
                '<button id="dchat-send" class="dchat-send" type="button" aria-label="보내기">' +
                    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
                '</button>' +
            '</div>';
        document.body.appendChild(ov);
        document.body.appendChild(pn);
        // 슬라이드 인
        requestAnimationFrame(function () { ov.classList.add('show'); pn.classList.add('show'); });

        state.open = true;
        ov.addEventListener('click', closePanel);
        pn.querySelector('.dchat-close').addEventListener('click', closePanel);

        var scroll = document.getElementById('dchat-scroll');
        scroll.addEventListener('scroll', function () { if (scroll.scrollTop < 40) loadMore(); });

        var input = document.getElementById('dchat-input');
        var sendBtn = document.getElementById('dchat-send');
        function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
        input.addEventListener('input', autoGrow);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
        });
        sendBtn.addEventListener('click', doSend);
        function doSend() {
            var text = input.value.trim();
            if (!text) return;
            if (!wsSend({ type: 'msg', roomId: Number(roomId()), content: text })) {
                // 소켓 끊김 → 재연결 시도 후 REST 폴백은 생략(실시간 특성상), 안내만
                wsConnect();
                toast('연결이 끊겼어요. 잠시 후 다시 시도해주세요');
                return;
            }
            input.value = ''; autoGrow(); input.focus();
        }

        wsConnect();
        loadHistory().then(function () { setTimeout(function () { input && input.focus(); }, 100); });
    }

    // ===== 스타일 (프로젝트 CSS 변수 사용 → 다크모드 자동 대응) =====
    function injectStyle() {
        if (document.getElementById('dchat-style')) return;
        var css =
            '#dchat-overlay{position:fixed;inset:0;z-index:9998;background:rgba(45,38,32,0.28);opacity:0;transition:opacity .22s ease;}' +
            '#dchat-overlay.show{opacity:1;}' +
            '#dchat-panel{position:fixed;top:0;right:0;z-index:9999;width:min(460px,100%);height:100%;height:100dvh;' +
                'background:var(--bg-color);display:flex;flex-direction:column;box-shadow:-8px 0 40px rgba(0,0,0,0.18);' +
                'transform:translateX(100%);transition:transform .26s cubic-bezier(.2,.8,.3,1);}' +
            '#dchat-panel.show{transform:none;}' +
            '.dchat-head{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;padding-top:calc(14px + var(--safe-t,0px));' +
                'background:var(--white);border-bottom:1px solid var(--gray-100);}' +
            '.dchat-head-title{font-size:1.06rem;font-weight:700;color:var(--gray-800);display:flex;align-items:center;gap:6px;}' +
            '.dchat-mc{font-size:0.86rem;font-weight:600;color:var(--gray-400);}' +
            '.dchat-mc:not(:empty)::before{content:"";}' +
            '.dchat-close{border:none;background:transparent;font-size:1.6rem;line-height:1;color:var(--gray-400);cursor:pointer;padding:0 4px;}' +
            '.dchat-scroll{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 14px 8px;display:flex;flex-direction:column;gap:2px;}' +
            '.dchat-empty{margin:auto;color:var(--gray-400);font-size:0.92rem;text-align:center;}' +
            '.dchat-daysep{text-align:center;margin:14px 0 10px;}' +
            '.dchat-daysep span{display:inline-block;background:var(--gray-100);color:var(--gray-500);font-size:0.72rem;padding:4px 12px;border-radius:12px;}' +
            '.dchat-sys{text-align:center;color:var(--gray-400);font-size:0.78rem;margin:6px 0;}' +
            // 공통 row
            '.dchat-row{display:flex;align-items:flex-end;gap:8px;margin:2px 0;max-width:100%;}' +
            '.dchat-row.mine{justify-content:flex-end;}' +
            '.dchat-row.other{justify-content:flex-start;align-items:flex-start;}' +
            '.dchat-row.head{margin-top:12px;}' +
            // 상대: 아바타(좌) + [닉네임/버블] 세로 컬럼 (카톡식)
            '.dchat-avacol{flex:0 0 auto;width:34px;}' +
            '.dchat-ava{width:34px;height:34px;border-radius:14px;object-fit:cover;display:block;background:var(--gray-100);}' +
            '.dchat-ava-ph{width:34px;height:34px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--primary-dark);background:var(--primary-light);font-size:0.95rem;}' +
            '.dchat-ava-spacer{display:block;width:34px;}' +
            '.dchat-othercol{display:flex;flex-direction:column;gap:3px;min-width:0;max-width:calc(100% - 46px);}' +
            '.dchat-name{font-size:0.82rem;color:var(--gray-600);font-weight:600;margin:0 0 1px 2px;}' +
            '.dchat-line{display:flex;align-items:flex-end;gap:6px;min-width:0;}' +
            // 버블
            '.dchat-bubble{font-size:0.95rem;line-height:1.45;padding:9px 12px;border-radius:16px;word-break:break-word;white-space:pre-wrap;max-width:100%;}' +
            '.dchat-row.other .dchat-bubble{background:var(--white);color:var(--gray-800);border:1px solid var(--gray-100);border-top-left-radius:5px;}' +
            '.dchat-row.mine .dchat-bubble{background:var(--primary);color:#fff;border-top-right-radius:5px;max-width:82%;box-shadow:0 1px 2px rgba(176,137,104,0.25);}' +
            // 메타(시간 + 안읽음수)
            '.dchat-meta{display:flex;align-items:flex-end;gap:4px;flex-shrink:0;padding-bottom:2px;}' +
            '.dchat-row.mine .dchat-meta{flex-direction:row;}' +
            '.dchat-time{font-size:0.68rem;color:var(--gray-400);white-space:nowrap;}' +
            '.dchat-unread{font-size:0.68rem;font-weight:700;color:var(--primary-dark);white-space:nowrap;line-height:1;}' +
            // 입력바
            '.dchat-inputbar{flex:0 0 auto;display:flex;align-items:flex-end;gap:8px;padding:10px 12px;padding-bottom:calc(10px + var(--safe-b,0px));' +
                'background:var(--white);border-top:1px solid var(--gray-100);}' +
            '.dchat-inputbar textarea{flex:1 1 auto;resize:none;border:1px solid var(--gray-200);background:var(--bg-color);color:var(--gray-800);' +
                'border-radius:20px;padding:10px 14px;font-size:0.95rem;font-family:inherit;line-height:1.4;max-height:120px;outline:none;}' +
            '.dchat-inputbar textarea:focus{border-color:var(--primary-light);}' +
            '.dchat-send{flex:0 0 auto;width:42px;height:42px;border-radius:50%;border:none;cursor:pointer;background:var(--primary);color:#fff;' +
                'display:flex;align-items:center;justify-content:center;transition:transform .12s,filter .15s;}' +
            '.dchat-send:hover{filter:brightness(.96);}' +
            '.dchat-send:active{transform:scale(.94);}' +
            // 상단 채팅 배지를 알림(notif-badge)과 완전히 동일한 빨간 동그라미 숫자형으로
            '.chat-btn .chat-badge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;' +
                'background:#e5322d;color:#fff;font-size:0.68rem;font-weight:800;line-height:18px;text-align:center;box-shadow:0 0 0 2px #fff;z-index:3;pointer-events:none;width:auto;}' +
            '.chat-btn .chat-badge.hidden{display:none;}';
        var st = document.createElement('style');
        st.id = 'dchat-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    // ===== 채팅 알림 끄기 토글 (방별 · 유저별) =====
    //  · 설정 메뉴의 #btn-room-chat-notif-toggle 스위치와 연동.
    //  · 스위치 ON = 채팅 푸시 켜짐 / OFF = 이 방 채팅 푸시만 끔(방 알림 토글과 별개).
    var chatMuted = false;
    function applyChatNotifToggle() {
        var btn = document.getElementById('btn-room-chat-notif-toggle');
        if (!btn) return;
        var on = !chatMuted;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    function loadChatMute() {
        if (!loggedIn() || !roomId()) return;
        fetch(API + '/api/chat/' + roomId() + '/mute', { headers: authHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d) { chatMuted = !!d.muted; applyChatNotifToggle(); } })
            .catch(function () {});
    }
    function toggleChatMute() {
        if (!loggedIn() || !roomId()) { toast('먼저 방을 선택해주세요'); return; }
        var next = !chatMuted;
        fetch(API + '/api/chat/' + roomId() + '/mute?muted=' + next, { method: 'POST', headers: authHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                chatMuted = (d && typeof d.muted === 'boolean') ? d.muted : next;
                applyChatNotifToggle();
                toast(chatMuted ? '채팅 알림 꺼짐' : '채팅 알림 켜짐');
            })
            .catch(function () { toast('변경에 실패했어요'); });
    }

    // ===== 초기화 =====
    function init() {
        injectStyle();
        // 상단 채팅 버튼(#btn-chat) 연결은 main.js 스텁에서 window.Daylog.openChat() 호출로 처리한다
        // (여기서 또 붙이면 리스너가 중복될 수 있어 배지/소켓만 담당).
        refreshBadge();
        wsConnect(); // 패널을 안 열어도 실시간 배지 갱신을 위해 상시 연결
        setInterval(refreshBadge, 30000);
        var _bcn = document.getElementById('btn-room-chat-notif-toggle'); // [B] 채팅 알림 끄기 토글
        if (_bcn) _bcn.addEventListener('click', toggleChatMute);
        loadChatMute();
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) { refreshBadge(); if (!ws || ws.readyState > 1) wsConnect(); }
        });
        window.addEventListener('focus', function () { if (!ws || ws.readyState > 1) wsConnect(); });
    }

    window.Daylog = window.Daylog || {};
    window.Daylog.openChat = openPanel;
    window.Daylog.refreshChatBadge = refreshBadge;

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
// [E] edit by smsong
