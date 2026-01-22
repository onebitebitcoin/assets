import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTotalsDetail, refreshSummary, snapshotTotals } from "../api.js";

const useTotals = (onSummaryUpdate) => {
  const initialLoadDone = useRef(false);
  const [period, setPeriod] = useState("daily");
  const [periodTotals, setPeriodTotals] = useState([]);
  const [tableColumns, setTableColumns] = useState([]);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [periodHasMore, setPeriodHasMore] = useState(false);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadTotals = useCallback(async (offset = 0, append = false, nextPeriod = period) => {
    setPeriodLoading(true);
    try {
      const data = await fetchTotalsDetail(nextPeriod, 7, offset);
      setPeriodTotals((prev) => (append ? [...prev, ...data.points] : data.points));
      setTableColumns(data.assets || []);
      setPeriodOffset(offset + data.points.length);
      setPeriodHasMore(data.points.length === 7);
    } catch (err) {
      setError(err.message);
    } finally {
      setPeriodLoading(false);
    }
  }, [period]);

  const onSnapshot = useCallback(async (loadSummary) => {
    setSnapshotLoading(true);
    setError("");
    setSuccess("");
    try {
      const refreshedData = await refreshSummary();
      if (onSummaryUpdate) {
        onSummaryUpdate(refreshedData);
      }
      await snapshotTotals();
      await Promise.all([
        loadTotals(0, false, period),
        loadSummary ? loadSummary() : Promise.resolve()
      ]);
      setSuccess("가격 갱신 후 스냅샷이 저장되었습니다.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSnapshotLoading(false);
    }
  }, [period, loadTotals, onSummaryUpdate]);

  const changePeriod = useCallback((newPeriod) => {
    setPeriod(newPeriod);
  }, []);

  const loadMore = useCallback(() => {
    loadTotals(periodOffset, true, period);
  }, [loadTotals, periodOffset, period]);

  useEffect(() => {
    if (!initialLoadDone.current) return;
    loadTotals(0, false, period);
  }, [period, loadTotals]);

  const markInitialLoadDone = useCallback(() => {
    initialLoadDone.current = true;
  }, []);

  return {
    period,
    periodTotals,
    tableColumns,
    periodOffset,
    periodHasMore,
    periodLoading,
    snapshotLoading,
    error,
    success,
    loadTotals,
    onSnapshot,
    changePeriod,
    loadMore,
    markInitialLoadDone,
    setError,
    setSuccess
  };
};

export default useTotals;
