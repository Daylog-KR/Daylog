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
    // [B] edit by smsong - 활성 채팅방: 1:1 방 등 특정 방을 열 때 사용. null 이면 현재 선택된 방.
    var activeRoomId = null;
    function roomId() { return activeRoomId || localStorage.getItem('selectedRoomId') || ''; }
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
        open: false, unread: 0,
        title: '채팅', direct: false, peerUid: null, peerProfileURL: null, roomImageURL: null // [B] edit by smsong - 헤더용
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
        return '<div class="dchat-row other' + (showHead ? ' head' : '') + '" data-id="' + m.id + '"' +
            ' data-uid="' + esc(m.senderUid || '') + '"' +
            ' data-name="' + esc(m.senderName || '') + '"' +
            ' data-profile="' + esc(m.senderProfileURL || '') + '">' +
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
                // [B] edit by smsong - 헤더 정보 저장
                state.title = h.title || '채팅';
                state.direct = !!h.direct;
                state.peerUid = h.peerUid || null;
                state.peerProfileURL = h.peerProfileURL || null;
                state.roomImageURL = h.roomImageURL || null; // [B] edit by smsong - 그룹방 헤더 썸네일
                chatMuted = !!h.muted;
                updateHeader();
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

    function updateHeader() {
        var titleEl = document.getElementById('dchat-title');
        var subEl = document.getElementById('dchat-sub');
        var avaEl = document.getElementById('dchat-head-ava');
        if (titleEl) titleEl.textContent = state.title || '채팅';
        if (subEl) {
            if (state.direct) subEl.textContent = '1:1 대화';
            else subEl.textContent = state.memberCount ? ('멤버 ' + state.memberCount + '명') : '';
        }
        if (avaEl) {
            if (state.direct && state.peerProfileURL) {
                avaEl.innerHTML = '<img src="' + esc(state.peerProfileURL) + '" alt="" referrerpolicy="no-referrer">';
                avaEl.className = 'dchat-head-ava has-img';
                avaEl.style.cursor = 'pointer';
                avaEl.onclick = function () { if (state.peerUid) openPeerProfile(state.peerUid, { name: state.title, profileURL: state.peerProfileURL }); };
            } else if (state.direct) {
                avaEl.innerHTML = esc((state.title || '?').trim().charAt(0) || '?');
                avaEl.className = 'dchat-head-ava ph';
                avaEl.style.cursor = 'pointer';
                avaEl.onclick = function () { if (state.peerUid) openPeerProfile(state.peerUid, { name: state.title }); };
            } else {
                // 그룹 방: 방 대표 이미지가 있으면 썸네일, 없으면 사람 아이콘
                if (state.roomImageURL) {
                    avaEl.innerHTML = '<img src="' + esc(state.roomImageURL) + '" alt="" referrerpolicy="no-referrer">';
                    avaEl.className = 'dchat-head-ava has-img';
                } else {
                    avaEl.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
                    avaEl.className = 'dchat-head-ava grp';
                }
                avaEl.style.cursor = 'default';
                avaEl.onclick = null;
            }
        }
    }

    // ===== [B] edit by smsong - 채팅방 설정 시트 (카카오톡식) =====
    function openChatSettings() {
        injectSettingsStyle();
        var ov = document.createElement('div');
        ov.id = 'dcs-overlay';
        ov.innerHTML =
            '<div class="dcs-sheet" role="dialog" aria-modal="true">' +
                '<div class="dcs-handle"></div>' +
                '<div class="dcs-title">' + esc(state.title || '채팅') + '</div>' +
                (state.direct
                    ? '<button class="dcs-row" id="dcs-peer" type="button">' +
                        '<span class="dcs-ic">' +
                          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
                        '</span><span class="dcs-label">상대 프로필 보기</span></button>'
                    : '') +
                '<button class="dcs-row" id="dcs-mute" type="button">' +
                    '<span class="dcs-ic">' +
                      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
                    '</span><span class="dcs-label">채팅 알림</span>' +
                    '<span class="dcs-switch" id="dcs-switch"></span>' +
                '</button>' +
                '<button class="dcs-row dcs-cancel" id="dcs-close" type="button"><span class="dcs-label">닫기</span></button>' +
            '</div>';
        document.body.appendChild(ov);
        requestAnimationFrame(function () { ov.classList.add('show'); });

        function syncSwitch() {
            var sw = document.getElementById('dcs-switch');
            if (sw) sw.classList.toggle('on', !chatMuted); // on = 알림 켜짐
        }
        syncSwitch();

        function close() {
            ov.classList.remove('show');
            setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 200);
        }
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        document.getElementById('dcs-close').addEventListener('click', close);
        var muteRow = document.getElementById('dcs-mute');
        if (muteRow) muteRow.addEventListener('click', function () {
            toggleChatMute(syncSwitch); // 서버 반영 완료 후 스위치 갱신
        });
        var peerRow = document.getElementById('dcs-peer');
        if (peerRow) peerRow.addEventListener('click', function () {
            close();
            if (state.peerUid) openPeerProfile(state.peerUid, { name: state.title, profileURL: state.peerProfileURL });
        });
    }
    function injectSettingsStyle() {
        if (document.getElementById('dcs-style')) return;
        var css =
            '#dcs-overlay{position:fixed;inset:0;z-index:10040;background:rgba(45,38,32,0.42);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .2s ease;}' +
            '#dcs-overlay.show{opacity:1;}' +
            '.dcs-sheet{width:100%;max-width:460px;background:var(--white);border-radius:22px 22px 0 0;padding:8px 12px calc(14px + var(--safe-b,0px));transform:translateY(16px);transition:transform .24s cubic-bezier(.2,.8,.3,1);}' +
            '#dcs-overlay.show .dcs-sheet{transform:none;}' +
            '.dcs-handle{width:38px;height:4px;border-radius:2px;background:var(--gray-200);margin:8px auto 6px;}' +
            '.dcs-title{font-size:1.02rem;font-weight:700;color:var(--gray-800);padding:6px 10px 12px;}' +
            '.dcs-row{display:flex;align-items:center;gap:12px;width:100%;padding:14px 10px;border:none;background:transparent;cursor:pointer;font-family:inherit;text-align:left;border-radius:12px;}' +
            '.dcs-row:active{background:var(--gray-50);}' +
            '.dcs-ic{flex:0 0 auto;color:var(--gray-500);display:flex;}' +
            '.dcs-label{flex:1 1 auto;font-size:0.98rem;font-weight:600;color:var(--gray-800);}' +
            '.dcs-cancel{justify-content:center;color:var(--gray-500);margin-top:2px;}' +
            '.dcs-cancel .dcs-label{flex:0 0 auto;color:var(--gray-500);font-weight:700;}' +
            '.dcs-switch{flex:0 0 auto;width:46px;height:27px;border-radius:14px;background:var(--gray-200);position:relative;transition:background .2s;}' +
            '.dcs-switch::after{content:"";position:absolute;top:3px;left:3px;width:21px;height:21px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s;}' +
            '.dcs-switch.on{background:var(--primary);}' +
            '.dcs-switch.on::after{transform:translateX(19px);}';
        var st = document.createElement('style');
        st.id = 'dcs-style';
        st.textContent = css;
        document.head.appendChild(st);
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

    // ===== [B] edit by smsong - 상대 프로필 모달 + 1:1 대화 시작 =====
    //  · 어디서든 Daylog.openPeerProfile(uid) 로 호출 (멤버 리스트/댓글/채팅 발신자 공용)
    //  · 프로필 사진 크게 + 이름 + [1:1 대화하기] 버튼
    function injectProfileStyle() {
        if (document.getElementById('dpp-style')) return;
        var css =
            '#dpp-overlay{position:fixed;inset:0;z-index:10050;background:rgba(45,38,32,0.5);' +
                'display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .18s ease;padding:24px;}' +
            '#dpp-overlay.show{opacity:1;}' +
            '.dpp-card{width:100%;max-width:320px;background:var(--white);border-radius:22px;padding:26px 22px 20px;' +
                'text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.28);transform:scale(.94);transition:transform .2s cubic-bezier(.2,.8,.3,1);}' +
            '#dpp-overlay.show .dpp-card{transform:none;}' +
            '.dpp-ava{width:110px;height:110px;border-radius:50%;object-fit:cover;margin:0 auto 14px;display:block;background:var(--gray-100);}' +
            '.dpp-ava-ph{width:110px;height:110px;border-radius:50%;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;' +
                'font-size:2.6rem;font-weight:700;color:var(--primary-dark);background:var(--primary-light);}' +
            '.dpp-name{font-size:1.18rem;font-weight:700;color:var(--gray-800);margin-bottom:4px;}' +
            '.dpp-sub{font-size:0.82rem;color:var(--gray-400);margin-bottom:20px;}' +
            '.dpp-actions{display:flex;flex-direction:column;gap:8px;}' +
            '.dpp-btn{width:100%;padding:13px;border-radius:14px;border:none;cursor:pointer;font-family:inherit;font-size:0.96rem;font-weight:700;}' +
            '.dpp-btn.primary{background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;gap:7px;}' +
            '.dpp-btn.primary:active{transform:scale(.98);}' +
            '.dpp-btn.ghost{background:var(--gray-100);color:var(--gray-600);}';
        var st = document.createElement('style');
        st.id = 'dpp-style';
        st.textContent = css;
        document.head.appendChild(st);
    }
    function closePeerProfile() {
        var ov = document.getElementById('dpp-overlay');
        if (!ov) return;
        ov.classList.remove('show');
        setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 200);
    }
    // 이미 알고 있는 정보(이름/프로필)를 넘기면 즉시 표시하고, uid 로 최신 프로필을 보강한다.
    function openPeerProfile(uid, hint) {
        if (!uid) return;
        if (uid === myUid()) { toast('나 자신과는 대화할 수 없어요'); return; }
        injectProfileStyle();
        closePeerProfile();
        hint = hint || {};

        var ov = document.createElement('div');
        ov.id = 'dpp-overlay';
        ov.innerHTML =
            '<div class="dpp-card" role="dialog" aria-modal="true">' +
                '<div id="dpp-ava-slot"></div>' +
                '<div class="dpp-name" id="dpp-name">' + esc(hint.name || '사용자') + '</div>' +
                '<div class="dpp-sub" id="dpp-sub"></div>' +
                '<div class="dpp-actions">' +
                    '<button class="dpp-btn primary" id="dpp-chat" type="button">' +
                        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
                        '1:1 대화하기' +
                    '</button>' +
                    '<button class="dpp-btn ghost" id="dpp-close" type="button">닫기</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(ov);
        requestAnimationFrame(function () { ov.classList.add('show'); });

        function setAvatar(url, nm) {
            var slot = document.getElementById('dpp-ava-slot');
            if (!slot) return;
            if (url) slot.innerHTML = '<img class="dpp-ava" src="' + esc(url) + '" alt="" referrerpolicy="no-referrer">';
            else slot.innerHTML = '<span class="dpp-ava-ph">' + esc((nm || '?').trim().charAt(0) || '?') + '</span>';
        }
        setAvatar(hint.profileURL, hint.name);

        ov.addEventListener('click', function (e) { if (e.target === ov) closePeerProfile(); });
        document.getElementById('dpp-close').addEventListener('click', closePeerProfile);
        document.getElementById('dpp-chat').addEventListener('click', function () { startDirectChat(uid); });

        // 최신 프로필 보강
        fetch(API + '/api/chat/peer/' + encodeURIComponent(uid), { headers: authHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (p) {
                if (!p) return;
                var nm = p.displayName || p.nickname || p.name || hint.name || '사용자';
                var nameEl = document.getElementById('dpp-name'); if (nameEl) nameEl.textContent = nm;
                setAvatar(p.profileURL, nm);
            })
            .catch(function () {});
    }
    // 1:1 방 생성/조회 후 그 방으로 채팅 열기
    function startDirectChat(peerUid) {
        var btn = document.getElementById('dpp-chat');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
        fetch(API + '/api/chat/direct?peerUid=' + encodeURIComponent(peerUid), { method: 'POST', headers: authHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d || !d.roomId) { toast('대화를 시작하지 못했어요'); if (btn) { btn.disabled = false; btn.style.opacity = ''; } return; }
                closePeerProfile();
                openPanel(String(d.roomId)); // 해당 1:1 방으로 채팅 열기
            })
            .catch(function () { toast('대화를 시작하지 못했어요'); if (btn) { btn.disabled = false; btn.style.opacity = ''; } });
    }

    // ===== 패널 열기/닫기 =====
    function closePanel() {
        state.open = false;
        var wasActive = activeRoomId;
        var ov = document.getElementById('dchat-overlay');
        var pn = document.getElementById('dchat-panel');
        if (pn) pn.classList.remove('show');
        if (ov) ov.classList.remove('show');
        setTimeout(function () {
            if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
            if (pn && pn.parentNode) pn.parentNode.removeChild(pn);
        }, 240);
        // [B] edit by smsong - 1:1 방을 보고 있었다면, 닫을 때 현재 방(그룹) 구독으로 복귀
        activeRoomId = null;
        if (wasActive && ws && ws.readyState === WebSocket.OPEN) {
            var cur = localStorage.getItem('selectedRoomId');
            if (cur) wsSend({ type: 'sub', roomId: Number(cur) });
        }
        refreshBadge();
        // [B] edit by smsong - rooms.html 채팅 리스트가 열려 있으면 닫힌 뒤 갱신
        if (typeof window.Daylog.onChatClosed === 'function') {
            try { window.Daylog.onChatClosed(); } catch (e) {}
        }
    }

    function openPanel(targetRoomId) {
        if (!loggedIn()) { toast('로그인이 필요해요'); return; }
        // [B] edit by smsong - 이미 열려있으면 '먼저' 닫는다. closePanel 이 activeRoomId 를 null 로
        //  되돌리므로, 반드시 닫은 뒤에 activeRoomId 를 지정해야 1:1 등 지정 방이 유지된다.
        //  (기존엔 activeRoomId 지정 → closePanel 순서라, 지정 방이 지워져 이전 방/빈 채팅이 떴다)
        if (document.getElementById('dchat-panel')) {
            closePanel();
        }
        // 특정 방(1:1 등) 지정 시 활성 방으로. 없으면 현재 선택된 방.
        activeRoomId = (targetRoomId && String(targetRoomId)) || null;
        if (!roomId()) { toast('먼저 방을 선택해주세요'); return; }
        injectStyle();

        var ov = document.createElement('div');
        ov.id = 'dchat-overlay';
        var pn = document.createElement('div');
        pn.id = 'dchat-panel';
        pn.innerHTML =
            '<div class="dchat-head">' +
                '<div class="dchat-head-main">' +
                    '<div id="dchat-head-ava" class="dchat-head-ava"></div>' +
                    '<div class="dchat-head-texts">' +
                        '<div class="dchat-head-title" id="dchat-title">채팅</div>' +
                        '<div class="dchat-head-sub" id="dchat-sub"></div>' +
                    '</div>' +
                '</div>' +
                '<div class="dchat-head-actions">' +
                    '<button class="dchat-gear" id="dchat-gear" type="button" aria-label="채팅방 설정">' +
                        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
                    '</button>' +
                    '<button class="dchat-close" type="button" aria-label="닫기">&times;</button>' +
                '</div>' +
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
        var gear = document.getElementById('dchat-gear');
        if (gear) gear.addEventListener('click', openChatSettings); // [B] edit by smsong - 채팅방 설정

        var scroll = document.getElementById('dchat-scroll');
        scroll.addEventListener('scroll', function () { if (scroll.scrollTop < 40) loadMore(); });
        // [B] edit by smsong - 상대 아바타/이름 클릭 → 프로필 모달 (1:1 대화 시작 가능)
        scroll.addEventListener('click', function (e) {
            var head = e.target.closest ? e.target.closest('.dchat-avacol, .dchat-name') : null;
            if (!head) return;
            var row = head.closest('.dchat-row.other');
            if (!row) return;
            var uid = row.getAttribute('data-uid');
            var nm = row.getAttribute('data-name') || '';
            var pf = row.getAttribute('data-profile') || '';
            if (uid) openPeerProfile(uid, { name: nm, profileURL: pf });
        });

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

        // 소켓이 이미 열려 있으면 이 방을 명시적으로 구독(1:1 방으로 전환 시 필요)
        if (ws && ws.readyState === WebSocket.OPEN) {
            wsSend({ type: 'sub', roomId: Number(roomId()) });
        } else {
            wsConnect();
        }
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
            '.dchat-head{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;padding-top:calc(12px + var(--safe-t,0px));' +
                'background:var(--white);border-bottom:1px solid var(--gray-100);}' +
            '.dchat-head-main{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 auto;}' +
            '.dchat-head-ava{flex:0 0 auto;width:38px;height:38px;border-radius:13px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--gray-100);color:var(--gray-500);}' +
            '.dchat-head-ava img{width:100%;height:100%;object-fit:cover;display:block;image-orientation:from-image;}' +
            '.dchat-head-ava.ph{background:var(--primary-light);color:var(--primary-dark);font-weight:700;font-size:1.05rem;}' +
            '.dchat-head-texts{min-width:0;display:flex;flex-direction:column;}' +
            '.dchat-head-title{font-size:1.02rem;font-weight:700;color:var(--gray-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.dchat-head-sub{font-size:0.76rem;color:var(--gray-400);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.dchat-head-actions{flex:0 0 auto;display:flex;align-items:center;gap:2px;}' +
            '.dchat-gear{border:none;background:transparent;color:var(--gray-400);cursor:pointer;padding:6px;display:flex;border-radius:10px;}' +
            '.dchat-gear:hover{background:var(--gray-50);color:var(--gray-600);}' +
            '.dchat-close{border:none;background:transparent;font-size:1.6rem;line-height:1;color:var(--gray-400);cursor:pointer;padding:0 6px;}' +
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
            '.dchat-avacol{flex:0 0 auto;width:34px;cursor:pointer;}' +
            '.dchat-ava{width:34px;height:34px;border-radius:14px;object-fit:cover;display:block;background:var(--gray-100);}' +
            '.dchat-ava-ph{width:34px;height:34px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--primary-dark);background:var(--primary-light);font-size:0.95rem;}' +
            '.dchat-ava-spacer{display:block;width:34px;}' +
            '.dchat-othercol{display:flex;flex-direction:column;gap:3px;min-width:0;max-width:calc(100% - 46px);}' +
            '.dchat-name{font-size:0.82rem;color:var(--gray-600);font-weight:600;margin:0 0 1px 2px;cursor:pointer;}' +
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
    function toggleChatMute(done) {
        if (!loggedIn() || !roomId()) { toast('먼저 방을 선택해주세요'); return; }
        var next = !chatMuted;
        fetch(API + '/api/chat/' + roomId() + '/mute?muted=' + next, { method: 'POST', headers: authHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                chatMuted = (d && typeof d.muted === 'boolean') ? d.muted : next;
                applyChatNotifToggle();
                toast(chatMuted ? '채팅 알림 꺼짐' : '채팅 알림 켜짐');
                if (typeof done === 'function') done();
            })
            .catch(function () { toast('변경에 실패했어요'); if (typeof done === 'function') done(); });
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

        // [B] edit by smsong - 채팅 푸시 클릭 진입: URL 에 chat=1 이면 해당 방 채팅을 바로 연다.
        //  (웹푸시 url = /main.html?room={id}&chat=1 → sw.js 가 이 주소로 이동 → 여기서 패널 오픈)
        try {
            var qs = new URLSearchParams(location.search || '');
            if (qs.get('chat') === '1') {
                var rid = qs.get('room') || roomId();
                setTimeout(function () {
                    try { openPanel(rid ? String(rid) : undefined); } catch (e) {}
                    // 새로고침 시 재오픈 방지: chat 파라미터만 제거
                    try {
                        qs.delete('chat');
                        var q = qs.toString();
                        history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
                    } catch (e) {}
                }, 400);
            }
        } catch (e) {}
    }

    window.Daylog = window.Daylog || {};
    window.Daylog.openChat = openPanel;
    window.Daylog.openPeerProfile = openPeerProfile;   // [B] edit by smsong - 프로필 모달(멤버/댓글/채팅 공용)
    window.Daylog.startDirectChat = startDirectChat;   // [B] edit by smsong - 1:1 대화 시작
    window.Daylog.refreshChatBadge = refreshBadge;

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
// [E] edit by smsong
