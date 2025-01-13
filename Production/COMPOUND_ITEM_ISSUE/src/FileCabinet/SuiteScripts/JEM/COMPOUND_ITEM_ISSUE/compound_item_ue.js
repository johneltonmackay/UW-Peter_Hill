/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search'],
    /**
 * @param{record} record
 * @param{search} search
 */
    (record, search) => {
        const COMPOUND_ITEM_TEST = 30727
        const XP_13287 = 30453
        const ARR_VALID_ITEMS = ['30727']
        const OBJ_ITEMPAIR_MAPPING = {
            [COMPOUND_ITEM_TEST]: XP_13287
        }

        const arrFieldIds = ['rate', 'custcol_original_cost', 'custcol_cost_adjustment', 'custcol_adjusted_flag'];

        const beforeSubmit = (scriptContext) => {
            if (scriptContext.type === scriptContext.UserEventType.DELETE) {
                try {            
                    const objRec = scriptContext.newRecord
                    if (objRec){
                        let hasTransferOrder = objRec.getValue({ fieldId: 'custbody_related_transfer_order' }); 
                        if (hasTransferOrder) {
                            record.delete({ type: 'transferorder', id: hasTransferOrder });
                            log.debug('beforeSubmit Transfer Order Deleted', 'Transfer Order ID: ' + hasTransferOrder);
                        }
                    }
                } catch (e) {
                    log.error('beforeSubmit Error Deleting Transfer Order', e.message);
                }
            }
        }
        
        const afterSubmit = (scriptContext) => {
            log.debug('scriptContext.type', scriptContext.type)
            try {
                const objRec = scriptContext.newRecord
                if (scriptContext.type === scriptContext.UserEventType.EDIT || scriptContext.type === scriptContext.UserEventType.CREATE) {
                    let intRate = 0
                    let arrTransferOrderData = []
                    const objCurrentRecord = record.load({
                        type: objRec.type,
                        id: objRec.id,
                        isDynamic: true
                    })
                    if (objCurrentRecord){
                        let lineCount = objCurrentRecord.getLineCount({sublistId: 'item'})
                        if (lineCount > 0) {
                            for (let i = 0; i < lineCount; i++) {
                                objCurrentRecord.selectLine({
                                    sublistId: 'item',
                                    line: i
                                })
                                let intItemIdA = objCurrentRecord.getCurrentSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'item'
                                })
                                let intQty = objCurrentRecord.getCurrentSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'quantity'
                                })
                                let isAdjusted = objCurrentRecord.getCurrentSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'custcol_adjusted_flag'
                                })
                                let strLineUniqueKey = objCurrentRecord.getCurrentSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'lineuniquekey'
                                })

                                if (scriptContext.type === scriptContext.UserEventType.EDIT){
                                    intRate = objCurrentRecord.getCurrentSublistValue({
                                        sublistId: 'item',
                                        fieldId: 'custcol_original_cost'
                                    })
                                } else {
                                    if (!isAdjusted){
                                        intRate = objCurrentRecord.getCurrentSublistValue({
                                            sublistId: 'item',
                                            fieldId: 'rate'
                                        })
                                    } else {
                                        intRate = objCurrentRecord.getCurrentSublistValue({
                                            sublistId: 'item',
                                            fieldId: 'custcol_original_cost'
                                        })
                                    }
                                }

                                log.debug('ARR_VALID_ITEMS', ARR_VALID_ITEMS)
                                log.debug('intItemIdA', intItemIdA)
                                log.debug('isAdjusted', isAdjusted)
                                if (ARR_VALID_ITEMS.includes(intItemIdA)) {
                                    let itemBCost = getVendorCost(intItemIdA)
                                    if (itemBCost){
                                        let totalItemBCost = itemBCost * intQty;
                                        let adjustedRate = intRate - itemBCost; 
                                        let validatedRate = adjustedRate ? adjustedRate : 0

                                        let objSetValues = {
                                            'item': XP_13287,
                                            'rate': validatedRate,
                                            'custcol_original_cost': intRate,
                                            'custcol_cost_adjustment': totalItemBCost,
                                            'custcol_adjusted_flag': true,
                                            'custcol_po_line_unique_key': strLineUniqueKey,
                                            'custbody_related_po': objRec.id,
                                            'quantity': intQty
                                        }

                                        Object.keys(objSetValues).forEach(fldId => {
                                            let arrSetFieldIds = ['rate', 'custcol_original_cost', 'custcol_cost_adjustment', 'custcol_adjusted_flag']
                                            if (arrSetFieldIds.includes(fldId)){
                                                objCurrentRecord.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: fldId,
                                                    line: i,
                                                    value: objSetValues[fldId]
                                                });
                                            }
                                        });

                                        arrTransferOrderData.push(objSetValues)

                                    }
                                } else {
                                    log.debug(`intItemIdA in Line: ${i} is not Valid`, intItemIdA)
                                }

                                objCurrentRecord.commitLine({
                                    sublistId: 'item'
                                });
                            }

                            if (arrTransferOrderData.length > 0){
                                let hasTransferOrder = objCurrentRecord.getValue({ fieldId: 'custbody_related_transfer_order' }); 
                                log.debug('afterSubmit hasTransferOrder', hasTransferOrder)
                                if (!hasTransferOrder) {
                                    let intTransferOrderId = createTransferOrder(arrTransferOrderData)
                                    if (intTransferOrderId){
                                        objCurrentRecord.setValue({ fieldId: 'custbody_related_transfer_order', value: intTransferOrderId }); 
                                    }
                                } else {
                                    updateTransferOrder(arrTransferOrderData, hasTransferOrder)
                                }
                            }

                            let recordId = objCurrentRecord.save({
                                enableSourcing: true,
                                ignoreMandatoryFields: true
                            });
                            log.debug("afterSubmit recordId " + objRec.type, recordId)

                        }


                    }
                }
            } catch (error) {
                log.error('afterSubmit error', error.message)
            }
        }

        //PRIVATE FUNCTION

        const getVendorCost = (intItemIdA) => {
            let itemIdB = null
            let intItemBCost = 0
            try {
                for (let key in OBJ_ITEMPAIR_MAPPING) {
                    if (key == intItemIdA) {
                        log.debug('getVendorCost key', key)
                        log.debug('getVendorCost value', OBJ_ITEMPAIR_MAPPING[key])
                        itemIdB = OBJ_ITEMPAIR_MAPPING[key]
                    }
                }
                log.debug('getVendorCost itemIdB', itemIdB)
                if (itemIdB){
                    let fieldLookUp = search.lookupFields({
                        type: 'inventoryitem',
                        id: itemIdB,
                        columns: ['custitem_vendor_cost']
                    });
                    log.debug('getVendorCost fieldLookUp', fieldLookUp)
                    if (fieldLookUp) {
                        let { custitem_vendor_cost } = fieldLookUp;
                        intItemBCost = custitem_vendor_cost ? parseFloat(custitem_vendor_cost) : 0
                    }
                }
            } catch (error) {
                log.error('getVendorCost error', error.message)
            }
            log.debug('getVendorCost intItemBCost', intItemBCost)
            return intItemBCost
        }

        const createTransferOrder = (arrTransferOrderData) => {
            log.debug('createTransferOrder arrTransferOrderData', arrTransferOrderData)
            let intTransferOrderId = null
            try {
                let objTransferOrderRecord = record.create({ type: 'transferorder', isDynamic: true });
                objTransferOrderRecord.setValue({ fieldId: 'location', value: 24 }); // Aquatec location
                objTransferOrderRecord.setValue({ fieldId: 'transferlocation', value: 1 }); // Finished goods location
                // objTransferOrderRecord.setValue({ fieldId: 'orderstatus', value: 'B' }); // Automatically approve the transfer order
                objTransferOrderRecord.setValue({ fieldId: 'custbody_related_po', value: arrTransferOrderData[0].custbody_related_po });

                arrTransferOrderData.forEach((data, index) => {
                    objTransferOrderRecord.selectNewLine({ sublistId: 'item' });
                
                    Object.keys(data).forEach(fldId => {
                        let arrSetFieldIds = ['item', 'quantity', 'custcol_po_line_unique_key']
                        if (arrSetFieldIds.includes(fldId)){
                            objTransferOrderRecord.setCurrentSublistValue({
                                sublistId: 'item',
                                fieldId: fldId,
                                value: data[fldId] 
                            });
                        }
                    });
                
                    objTransferOrderRecord.commitLine({ sublistId: 'item' });
                });
                
                intTransferOrderId = objTransferOrderRecord.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });
                log.debug(`Transfer Order Created and Approved', 'Transfer Order ID: + ${intTransferOrderId}`);
            } catch (error) {
                log.error('createTransferOrder error', error.message)
            }
            return intTransferOrderId
        }

        const updateTransferOrder = (arrTransferOrderData, transferOrderId) => {
            try {
                let objTransferOrderRecord = record.load({ type: 'transferorder', id: transferOrderId, isDynamic: true });

                if (objTransferOrderRecord){
                    arrTransferOrderData.forEach((data, index) => {

                        var intLineRec = objTransferOrderRecord.findSublistLineWithValue({
                            sublistId: 'item',
                            fieldId: 'custcol_po_line_unique_key',
                            value: data.custcol_po_line_unique_key
                        })
                        log.debug('updateTransferOrder: intLineRec', intLineRec)
                        if(intLineRec != -1){
                            objTransferOrderRecord.selectLine({
                                sublistId: 'item',
                                line: intLineRec
                            });
                            Object.keys(data).forEach(fldId => {
                                let arrSetFieldIds = ['quantity']
                                if (arrSetFieldIds.includes(fldId)){
                                    objTransferOrderRecord.setCurrentSublistValue({
                                        sublistId: 'item',
                                        fieldId: fldId,
                                        value: data[fldId] 
                                    });
                                }
                            });
                            objTransferOrderRecord.commitLine({sublistId:'item'})
                        }
                    });
        
                    let intTransferOrderId = objTransferOrderRecord.save({
                        enableSourcing: true,
                        ignoreMandatoryFields: true
                    });
                    log.debug('Transfer Order Updated', 'Transfer Order ID: ' + intTransferOrderId);
                }
            } catch (e) {
                log.error('Error Updating Transfer Order', e.message);
            }
        }

        return {beforeSubmit, afterSubmit}
    });
