import { useCallback, useRef, useState } from "react";
import {
  addAsset,
  deleteAsset,
  fetchSummary,
  lookupSymbol,
  refreshSummary,
  updateAsset
} from "../api.js";

const useAssets = () => {
  const [summary, setSummary] = useState({ total_krw: 0, daily_change_krw: 0, assets: [] });
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", symbol: "", quantity: "", price_krw: "" });
  const [addingNew, setAddingNew] = useState(false);
  const [newAssetForm, setNewAssetForm] = useState({
    name: "", symbol: "", asset_type: "stock", quantity: 1, custom_type: "", price_krw: ""
  });
  const [saving, setSaving] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const lookupTimeoutRef = useRef(null);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setError("");
    try {
      const data = await fetchSummary();
      setSummary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setError("");
    setSuccess("");
    try {
      const refreshedData = await refreshSummary();
      setSummary(refreshedData);
      setSuccess("가격이 갱신되었습니다.");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const startEdit = useCallback((asset) => {
    setEditingAssetId(asset.id);
    setEditForm({
      name: asset.name,
      symbol: asset.symbol || "",
      quantity: String(asset.quantity),
      price_krw: asset.last_price_krw ? String(asset.last_price_krw) : ""
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingAssetId(null);
    setEditForm({ name: "", symbol: "", quantity: "", price_krw: "" });
  }, []);

  const handleSymbolChange = useCallback((symbol, assetType) => {
    setNewAssetForm((prev) => ({ ...prev, symbol }));

    if (lookupTimeoutRef.current) {
      clearTimeout(lookupTimeoutRef.current);
    }

    if (!["stock", "kr_stock"].includes(assetType) || !symbol.trim()) {
      return;
    }

    lookupTimeoutRef.current = setTimeout(async () => {
      setLookingUp(true);
      try {
        const result = await lookupSymbol(symbol.trim(), assetType);
        setNewAssetForm((prev) => {
          if (result.name && !prev.name.trim()) {
            return { ...prev, name: result.name };
          }
          return prev;
        });
      } catch {
        // 조회 실패 시 무시
      } finally {
        setLookingUp(false);
      }
    }, 500);
  }, []);

  const saveEdit = useCallback(async (assetId) => {
    const quantity = Number(editForm.quantity);
    const currentAsset = summary.assets.find((a) => a.id === assetId);
    const isCustom = currentAsset && !["stock", "crypto", "kr_stock", "cash"].includes(currentAsset.asset_type?.toLowerCase());

    if (!editForm.name.trim()) {
      setError("이름을 입력해주세요.");
      return;
    }
    if (!editForm.symbol.trim()) {
      setError("티커를 입력해주세요.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("수량은 0보다 큰 숫자만 가능합니다.");
      return;
    }

    let priceValue = null;
    if (isCustom && editForm.price_krw) {
      priceValue = Number(editForm.price_krw);
      if (!Number.isFinite(priceValue) || priceValue <= 0) {
        setError("단가는 0보다 큰 숫자만 가능합니다.");
        return;
      }
    }

    setSaving(true);
    setError("");
    const prevAssets = summary.assets;
    setSummary((prev) => ({
      ...prev,
      assets: prev.assets.map((a) =>
        a.id === assetId ? {
          ...a,
          name: editForm.name.trim(),
          symbol: editForm.symbol.trim(),
          quantity,
          ...(priceValue ? { last_price_krw: priceValue } : {})
        } : a
      )
    }));
    try {
      await updateAsset(assetId, {
        name: editForm.name.trim(),
        symbol: editForm.symbol.trim(),
        quantity,
        ...(priceValue ? { price_krw: priceValue } : {})
      });
      setSuccess("저장되었습니다.");
      cancelEdit();
    } catch (err) {
      setSummary((prev) => ({ ...prev, assets: prevAssets }));
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [editForm, summary.assets, cancelEdit]);

  const handleDelete = useCallback(async (assetId, assetName) => {
    if (!window.confirm(`"${assetName}"을(를) 삭제하시겠습니까?`)) return;
    setError("");
    try {
      await deleteAsset(assetId);
      setSummary((prev) => ({
        ...prev,
        assets: prev.assets.filter((a) => a.id !== assetId)
      }));
      setSuccess("자산이 삭제되었습니다.");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const handleAddAsset = useCallback(async () => {
    const quantity = Number(newAssetForm.quantity);
    if (!newAssetForm.name.trim()) {
      setError("이름을 입력해주세요.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("수량은 0보다 큰 숫자만 가능합니다.");
      return;
    }
    const isCustom = newAssetForm.asset_type === "custom";
    const customType = newAssetForm.custom_type.trim();
    if (isCustom && !customType) {
      setError("직접 입력 유형을 입력해주세요.");
      return;
    }
    let priceValue = null;
    if (isCustom) {
      priceValue = Number(newAssetForm.price_krw);
      if (!Number.isFinite(priceValue) || priceValue <= 0) {
        setError("단가는 1 이상의 숫자만 가능합니다.");
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      await addAsset({
        name: newAssetForm.name.trim(),
        asset_type: isCustom ? customType : newAssetForm.asset_type,
        symbol: isCustom
          ? customType
          : newAssetForm.asset_type === "crypto"
            ? "BTC"
            : newAssetForm.asset_type === "cash"
              ? "CASH"
              : newAssetForm.symbol.trim().toUpperCase() || newAssetForm.name.trim().toUpperCase(),
        quantity,
        ...(priceValue ? { price_krw: priceValue } : {})
      });
      setNewAssetForm({ name: "", symbol: "", asset_type: "stock", quantity: 1, custom_type: "", price_krw: "" });
      setAddingNew(false);
      await loadSummary();
      setSuccess("자산이 추가되었습니다.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [newAssetForm, loadSummary]);

  const resetNewAssetForm = useCallback(() => {
    setAddingNew(false);
    setNewAssetForm({ name: "", symbol: "", asset_type: "stock", quantity: 1, custom_type: "", price_krw: "" });
  }, []);

  const clearMessages = useCallback(() => {
    setError("");
    setSuccess("");
  }, []);

  return {
    summary,
    setSummary,
    summaryLoading,
    error,
    setError,
    success,
    setSuccess,
    editingAssetId,
    editForm,
    setEditForm,
    addingNew,
    setAddingNew,
    newAssetForm,
    setNewAssetForm,
    saving,
    lookingUp,
    loadSummary,
    handleRefresh,
    startEdit,
    cancelEdit,
    handleSymbolChange,
    saveEdit,
    handleDelete,
    handleAddAsset,
    resetNewAssetForm,
    clearMessages
  };
};

export default useAssets;
