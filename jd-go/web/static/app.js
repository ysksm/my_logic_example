function app() {
    return {
        // State
        projects: [],
        selectedProject: '',
        error: null,
        syncing: false,
        syncStatus: '',
        lastSyncInfo: '前回同期: なし',
        hasCheckpoint: false,
        hasData: false,
        progressText: '',
        progressPercent: 0,
        activeTab: 'charts',
        tabs: [
            { id: 'charts', name: '可視化' },
            { id: 'history', name: '履歴分析' },
            { id: 'sql', name: 'SQL クエリ' },
        ],
        snapshotDate: new Date().toISOString().split('T')[0],
        snapshotData: null,
        sqlQuery: 'SELECT "key", summary, status, priority, assignee FROM issues LIMIT 20',
        queryResult: null,
        queryError: null,
        eventSource: null,
        charts: {},

        async init() {
            try {
                const resp = await fetch('/api/projects');
                if (!resp.ok) throw new Error('Jira 接続に失敗しました');
                this.projects = await resp.json();
            } catch (e) {
                this.error = e.message;
            }

            // Watch tab changes to reload charts
            this.$watch('activeTab', () => {
                if (this.hasData && this.selectedProject) {
                    this.$nextTick(() => this.loadChartsForTab());
                }
            });

            // Resize charts on window resize
            window.addEventListener('resize', () => {
                Object.values(this.charts).forEach(c => c.resize());
            });
        },

        async onProjectChange() {
            if (!this.selectedProject) return;
            this.hasData = false;
            this.snapshotData = null;
            await this.loadSyncStatus();
            await this.loadCharts();
        },

        async loadSyncStatus() {
            try {
                const resp = await fetch(`/api/sync/status/${this.selectedProject}`);
                const data = await resp.json();
                if (data.last_sync) {
                    const ls = data.last_sync;
                    this.lastSyncInfo = `前回: ${ls.completed_at} (${ls.sync_type}, ${ls.items_synced}件)`;
                } else {
                    this.lastSyncInfo = '前回同期: なし';
                }
                this.hasCheckpoint = !!data.checkpoint;
            } catch (e) {
                console.error('Failed to load sync status', e);
            }
        },

        async startSync(mode) {
            this.syncing = true;
            this.syncStatus = `${mode} 同期中...`;
            this.progressText = '準備中...';
            this.progressPercent = 0;

            // Connect SSE
            this.eventSource = new EventSource('/api/sync/progress');
            this.eventSource.addEventListener('progress', (e) => {
                const d = JSON.parse(e.data);
                this.progressText = `${d.fetched} / ${d.total} 件`;
                this.progressPercent = d.total > 0 ? (d.fetched / d.total) * 100 : 0;
            });
            this.eventSource.addEventListener('complete', (e) => {
                const result = JSON.parse(e.data);
                this.syncing = false;
                this.syncStatus = '';
                this.progressPercent = 100;
                this.eventSource.close();
                this.eventSource = null;
                this.loadSyncStatus();
                this.loadCharts();
            });
            this.eventSource.addEventListener('error', (e) => {
                if (e.data) {
                    const d = JSON.parse(e.data);
                    this.error = d.error;
                }
                this.syncing = false;
                this.syncStatus = '';
                if (this.eventSource) {
                    this.eventSource.close();
                    this.eventSource = null;
                }
            });
            this.eventSource.onerror = () => {
                // SSE connection error (not a custom error event)
                if (this.syncing) {
                    this.syncing = false;
                    this.syncStatus = '';
                }
                if (this.eventSource) {
                    this.eventSource.close();
                    this.eventSource = null;
                }
            };

            // Start sync
            const form = new FormData();
            form.append('mode', mode);
            try {
                await fetch(`/api/sync/${this.selectedProject}`, { method: 'POST', body: form });
            } catch (e) {
                this.error = e.message;
                this.syncing = false;
            }
        },

        async cancelSync() {
            try {
                await fetch('/api/sync/cancel', { method: 'POST' });
                this.syncing = false;
                this.syncStatus = 'キャンセル中...';
            } catch (e) {
                console.error(e);
            }
        },

        async loadCharts() {
            const pk = this.selectedProject;
            if (!pk) return;

            // Check if there's data
            try {
                const resp = await fetch('/api/query', {
                    method: 'POST',
                    body: new URLSearchParams({ query: `SELECT COUNT(*) as c FROM issues WHERE "key" LIKE '${pk}-%'` }),
                });
                const data = await resp.json();
                if (data.rows && data.rows.length > 0 && data.rows[0].c > 0) {
                    this.hasData = true;
                } else {
                    this.hasData = false;
                    return;
                }
            } catch (e) {
                return;
            }

            // Wait for DOM to render
            await this.$nextTick();
            await new Promise(r => setTimeout(r, 100));

            this.loadChartsForTab();
        },

        async loadChartsForTab() {
            const pk = this.selectedProject;
            if (!pk || !this.hasData) return;

            await this.$nextTick();
            await new Promise(r => setTimeout(r, 50));

            if (this.activeTab === 'charts') {
                this.loadDistributionCharts(pk);
            } else if (this.activeTab === 'history') {
                this.loadHistoryCharts(pk);
            }
        },

        async loadDistributionCharts(pk) {
            const [status, priority, type, assignee, monthly, fieldChanges, transitions] = await Promise.all([
                this.fetchJSON(`/api/charts/status/${pk}`),
                this.fetchJSON(`/api/charts/priority/${pk}`),
                this.fetchJSON(`/api/charts/type/${pk}`),
                this.fetchJSON(`/api/charts/assignee/${pk}`),
                this.fetchJSON(`/api/charts/monthly/${pk}`),
                this.fetchJSON(`/api/charts/field-changes/${pk}`),
                this.fetchJSON(`/api/charts/transitions/${pk}`),
            ]);

            this.renderBarChart('chart-status', 'ステータス別', status, 'status', 'count');
            this.renderBarChart('chart-priority', '優先度別', priority, 'priority', 'count');
            this.renderPieChart('chart-type', '課題タイプ別', type, 'issue_type', 'count');
            this.renderBarChart('chart-assignee', '担当者別 (Top 15)', assignee, 'assignee', 'count');
            this.renderLineChart('chart-monthly', '月別課題作成数', monthly, 'month', 'count');
            this.renderBarChart('chart-field-changes', 'フィールド別変更回数 (Top 10)', fieldChanges, 'field', 'count');
            this.renderHeatmapChart('chart-transitions', 'ステータス遷移', transitions);
        },

        async loadHistoryCharts(pk) {
            const [daily, createdResolved] = await Promise.all([
                this.fetchJSON(`/api/charts/daily-status/${pk}`),
                this.fetchJSON(`/api/charts/created-resolved/${pk}`),
            ]);

            this.renderStackedAreaChart('chart-daily-status', '日別ステータス別件数推移', daily);
            this.renderCreatedResolvedChart('chart-created-resolved', '日別 作成・完了件数', createdResolved);
        },

        async fetchJSON(url) {
            try {
                const resp = await fetch(url);
                return await resp.json();
            } catch (e) {
                console.error(`Failed to fetch ${url}`, e);
                return [];
            }
        },

        getOrCreateChart(id) {
            if (this.charts[id]) {
                this.charts[id].dispose();
            }
            const el = document.getElementById(id);
            if (!el) return null;
            const chart = echarts.init(el);
            this.charts[id] = chart;
            return chart;
        },

        renderBarChart(id, title, data, categoryKey, valueKey) {
            const chart = this.getOrCreateChart(id);
            if (!chart || !data || data.length === 0) return;
            chart.setOption({
                title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                grid: { left: '3%', right: '8%', bottom: '3%', top: '15%', containLabel: true },
                xAxis: { type: 'value' },
                yAxis: {
                    type: 'category',
                    data: data.map(d => d[categoryKey] || '(null)').reverse(),
                    axisLabel: { width: 120, overflow: 'truncate' },
                },
                series: [{
                    type: 'bar',
                    data: data.map(d => d[valueKey]).reverse(),
                    itemStyle: { borderRadius: [0, 4, 4, 0] },
                    colorBy: 'data',
                }],
            });
        },

        renderPieChart(id, title, data, nameKey, valueKey) {
            const chart = this.getOrCreateChart(id);
            if (!chart || !data || data.length === 0) return;
            chart.setOption({
                title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
                tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                series: [{
                    type: 'pie',
                    radius: ['35%', '65%'],
                    data: data.map(d => ({ name: d[nameKey], value: d[valueKey] })),
                    label: { formatter: '{b}\n{d}%' },
                    emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.5)' } },
                }],
            });
        },

        renderLineChart(id, title, data, xKey, yKey) {
            const chart = this.getOrCreateChart(id);
            if (!chart || !data || data.length === 0) return;
            chart.setOption({
                title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
                tooltip: { trigger: 'axis' },
                grid: { left: '3%', right: '4%', bottom: '3%', top: '15%', containLabel: true },
                xAxis: { type: 'category', data: data.map(d => d[xKey]), axisLabel: { rotate: 45 } },
                yAxis: { type: 'value' },
                series: [{
                    type: 'line',
                    data: data.map(d => d[yKey]),
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    areaStyle: { opacity: 0.1 },
                }],
            });
        },

        renderHeatmapChart(id, title, data) {
            const chart = this.getOrCreateChart(id);
            if (!chart || !data || data.length === 0) return;

            const fromSet = [...new Set(data.map(d => d.from_status))];
            const toSet = [...new Set(data.map(d => d.to_status))];
            const heatData = data.map(d => [
                toSet.indexOf(d.to_status),
                fromSet.indexOf(d.from_status),
                d.count,
            ]);
            const maxVal = Math.max(...data.map(d => d.count));

            chart.setOption({
                title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
                tooltip: {
                    position: 'top',
                    formatter: (p) => `${fromSet[p.value[1]]} → ${toSet[p.value[0]]}: ${p.value[2]}`,
                },
                grid: { left: '15%', right: '12%', bottom: '15%', top: '12%' },
                xAxis: { type: 'category', data: toSet, axisLabel: { rotate: 45, fontSize: 10 }, name: '遷移先' },
                yAxis: { type: 'category', data: fromSet, axisLabel: { fontSize: 10 }, name: '遷移元' },
                visualMap: { min: 0, max: maxVal, calculable: true, orient: 'vertical', right: '2%', top: 'center', inRange: { color: ['#e0f3ff', '#1e88e5'] } },
                series: [{
                    type: 'heatmap',
                    data: heatData,
                    label: { show: true, fontSize: 10 },
                    emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
                }],
            });
        },

        renderStackedAreaChart(id, title, data) {
            const chart = this.getOrCreateChart(id);
            if (!chart || !data || data.length === 0) return;

            const statuses = [...new Set(data.map(d => d.status))];
            const dates = [...new Set(data.map(d => d.date))].sort();

            const dataMap = {};
            data.forEach(d => { dataMap[d.date + '|' + d.status] = d.count; });

            const series = statuses.map(status => ({
                name: status,
                type: 'line',
                stack: 'total',
                areaStyle: {},
                emphasis: { focus: 'series' },
                data: dates.map(date => dataMap[date + '|' + status] || 0),
            }));

            chart.setOption({
                title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
                tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
                legend: { bottom: 0, type: 'scroll' },
                grid: { left: '3%', right: '4%', bottom: '12%', top: '12%', containLabel: true },
                xAxis: { type: 'category', data: dates, boundaryGap: false },
                yAxis: { type: 'value' },
                series: series,
            });
        },

        renderCreatedResolvedChart(id, title, data) {
            const chart = this.getOrCreateChart(id);
            if (!chart || !data || data.length === 0) return;

            const dates = data.map(d => d.date);
            const created = data.map(d => d.created);
            const resolved = data.map(d => d.resolved);

            // Compute cumulative open
            let cumCreated = 0, cumResolved = 0;
            const open = data.map(d => {
                cumCreated += d.created;
                cumResolved += d.resolved;
                return cumCreated - cumResolved;
            });

            chart.setOption({
                title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
                tooltip: { trigger: 'axis' },
                legend: { bottom: 0 },
                grid: { left: '3%', right: '8%', bottom: '12%', top: '12%', containLabel: true },
                xAxis: { type: 'category', data: dates },
                yAxis: [
                    { type: 'value', name: '件数' },
                    { type: 'value', name: '未完了', position: 'right' },
                ],
                series: [
                    { name: '作成', type: 'bar', data: created, itemStyle: { color: '#4c78a8' }, barGap: '0%' },
                    { name: '完了', type: 'bar', data: resolved, itemStyle: { color: '#72b7b2' } },
                    { name: '未完了', type: 'line', yAxisIndex: 1, data: open, itemStyle: { color: '#e45756' }, lineStyle: { width: 2 } },
                ],
            });
        },

        async loadSnapshot() {
            if (!this.snapshotDate || !this.selectedProject) return;
            try {
                const resp = await fetch(`/api/history/snapshot/${this.selectedProject}?date=${this.snapshotDate}`);
                this.snapshotData = await resp.json();
            } catch (e) {
                console.error(e);
            }
        },

        async executeQuery() {
            this.queryError = null;
            this.queryResult = null;
            try {
                const resp = await fetch('/api/query', {
                    method: 'POST',
                    body: new URLSearchParams({ query: this.sqlQuery }),
                });
                const data = await resp.json();
                if (data.error) {
                    this.queryError = data.error;
                } else {
                    this.queryResult = data;
                }
            } catch (e) {
                this.queryError = e.message;
            }
        },
    };
}
