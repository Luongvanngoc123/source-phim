$(document).ready(function(){
        // Error report modal - only for logged in users
        $('#btn-toggle-error').click(function(){
                        alert('Vui lòng đăng nhập để sử dụng tính năng báo lỗi!');
                    });

        $('#btn-cancel-error').click(function(){
            $('#error-report-modal').hide();
            $('#error-report-form')[0].reset();
            $('#error-description-box').hide();
            $('#error-message').hide();
        });

        $('input[name=error_type]').change(function(){
            if($(this).val() === 'other'){
                $('#error-description-box').show();
            }else{
                $('#error-description-box').hide();
            }
        });

        $('#error-report-form').submit(function(e){
            e.preventDefault();

            var errorType = $('input[name=error_type]:checked').val();
            var errorDesc = $('#error-description').val();

            if(errorType === 'other' && !errorDesc){
                $('#error-message').html('Vui lòng mô tả lỗi').css({background:'#ffebee',color:'#c62828',display:'block'});
                return;
            }

            $('#btn-submit-error').prop('disabled', true).text('Đang gửi...');

            $.ajax({
                url: '/ajax/report-error',
                type: 'POST',
                data: {
                    film_id: $('#error-film-id').val(),
                    episode_id: $('#error-episode-id').val(),
                    error_type: errorType,
                    error_description: errorDesc
                },
                dataType: 'json',
                success: function(response){
                    if(response.success){
                        $('#error-message').html(response.message).css({background:'#e8f5e9',color:'#2e7d32',display:'block'});
                        setTimeout(function(){
                            $('#error-report-modal').hide();
                            $('#error-report-form')[0].reset();
                            $('#error-description-box').hide();
                            $('#error-message').hide();
                        }, 2000);
                    }else{
                        $('#error-message').html(response.error).css({background:'#ffebee',color:'#c62828',display:'block'});
                    }
                },
                error: function(){
                    $('#error-message').html('Lỗi kết nối. Vui lòng thử lại.').css({background:'#ffebee',color:'#c62828',display:'block'});
                },
                complete: function(){
                    $('#btn-submit-error').prop('disabled', false).text('Gửi Báo Cáo');
                }
            });
        });
    });
